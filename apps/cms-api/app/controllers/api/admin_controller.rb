module Api
  class AdminController < ApplicationController
    before_action :authenticate_user!
    before_action :require_super_admin!
    before_action :require_write_super_admin!, only: %i[create_hub update_hub destroy_hub destroy_user move_user_to_hub super_admins upgrade_to_write_admin]

    def hubs
      aggregates = hub_aggregates
      render json: Hub.includes(:organization, :messaging_integrations).order(created_at: :desc).map { |hub| hub_row(hub, aggregates) }
    end

    def hub_detail
      hub = Hub.includes(:organization, :messaging_integrations).find(params[:id])
      render json: hub_row(hub, single_hub_aggregates(hub))
    end

    def create_hub
      # No hub admins yet, so trial emails would be recorded as sent to nobody.
      hub = Hub.create_with_organization!(name: create_hub_params[:name], plan: create_hub_params[:plan].presence || :free, trial_emails_enabled: false)
      LogService.log(:info, "AdminController", "Hub #{hub.id} (#{hub.name}) created by #{current_user.email}")
      render json: hub_row(hub, single_hub_aggregates(hub)), status: :created
    end

    def update_hub
      hub = Hub.find(params[:id])
      form = AdminHubUpdateForm.new(params.require(:hub))
      unless form.valid?
        return render json: {errors: form.errors.full_messages}, status: :unprocessable_content
      end
      if hub.update(form.attrs)
        render json: hub_row(hub, single_hub_aggregates(hub))
      else
        render json: {errors: hub.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy_hub
      hub = Hub.find_by(id: params[:id])
      return render json: {error: I18n.t(:error_not_found)}, status: :not_found if hub.nil?
      return render json: {error: I18n.t(:error_hub_deletion_not_free)}, status: :unprocessable_content unless hub.free?

      if hub.deletion_requested_at.nil?
        hub.update!(deletion_requested_at: Time.current, deletion_requested_by_email: current_user.email)
        LogService.log(:info, "AdminController", "Hub #{hub.id} (#{hub.name}) flagged for deletion by #{current_user.email}")
      else
        # Keep the original audit trail; re-enqueueing acts as a manual retry
        LogService.log(:info, "AdminController", "Hub #{hub.id} (#{hub.name}) deletion re-requested by #{current_user.email}")
      end
      HubDeletionWorker.perform_async(hub.id)
      render json: {message: I18n.t(:message_hub_deletion_scheduled)}, status: :accepted
    end

    def hub_activity
      hub = Hub.find(params[:id])
      render json: HubActivityService.new(hub.id).timeline
    end

    def hub_memberships
      memberships = HubMembership.where(hub_id: params[:id]).includes(:user, user: {profile_picture_attachment: :blob}).order(approved: :asc, created_at: :desc)
      render json: memberships.map { |m|
        {
          id: m.id,
          role: m.role,
          approved: m.approved,
          created_at: m.created_at&.iso8601,
          user: {
            id: m.user.id,
            name: m.user.name,
            email: m.user.email,
            confirmed: m.user.confirmed?,
            profile_picture_url: m.user.profile_picture_url,
            created_at: m.user.created_at&.iso8601,
            last_login_at: m.user.last_login_at&.iso8601,
            last_active_at: m.user.last_active_at&.iso8601
          }
        }
      }
    end

    def export_hubs
      aggregates = hub_aggregates

      headers = ["ID", "Name", "Organization Name", "Plan", "Trial Active", "Trial Expired", "Trial Ends At", "Invite Code", "Created At", "Editors Count", "Active Users", "Max Messages", "Sources Count", "Max Sources", "Documents Count", "Max Documents"]

      csv = CsvExporter.generate(headers: headers) do |csv|
        Hub.includes(:organization, :messaging_integrations).find_each do |hub|
          csv << hub_row(hub, aggregates).values_at(:id, :name, :organization_name, :plan, :trial_active, :trial_expired, :trial_ends_at, :invite_code, :created_at, :users_count, :active_external_users_count, :max_messages, :sources_count, :max_sources, :documents_count, :max_documents)
        end
      end

      send_data csv, type: "text/csv", disposition: "attachment", filename: "suwali-hubs-export-#{Date.today}.csv"
    end

    def export_message_reports
      headers = ["ID", "Hub ID", "Hub Name", "Message ID", "Message Link", "Platform", "User Question", "Message Body", "Message Sent At", "Reported By Email", "Comment", "Created At"]
      hub = Hub.find(params[:hub_id]) if params[:hub_id].present?
      reports = message_reports_scope(hub)

      csv = CsvExporter.generate(headers: headers) do |csv|
        reports.includes(message: [:reply_to, {conversation: :hub}], reported_by: []).find_each(order: :desc) do |report|
          row = message_report_row(report)
          csv << row.values_at(:id, :hub_id, :hub_name, :message_id, :message_link, :platform, :user_question, :message_body, :message_sent_at, :reported_by_email, :comment, :created_at)
        end
      end

      send_data csv, type: "text/csv", disposition: "attachment", filename: "suwali-message-reports-export-#{"hub-#{hub.id}-" if hub}#{Date.today}.csv"
    end

    def message_reports
      hub = Hub.find(params[:hub_id]) if params[:hub_id].present?
      reports = message_reports_scope(hub)
        .preload(message: [:reply_to, {conversation: :hub}], reported_by: [])
        .order(id: :desc)
      result = paginate(reports)

      render json: {data: result[:data].map { |report| message_report_row(report) }, pagination: result[:pagination]}
    end

    def unconfirmed_users
      users = User.where(confirmed_at: nil).includes(hub_memberships: :hub).order(created_at: :asc)
      rows = users.flat_map do |user|
        if user.hub_memberships.empty?
          [attention_user_row(user, nil, nil)]
        else
          user.hub_memberships.map { |m| attention_user_row(user, m.hub.name, m.hub.id) }
        end
      end
      render json: rows
    end

    def users_with_no_hub
      render json: User.left_joins(:hub_memberships).where(hub_memberships: {id: nil}).order(created_at: :asc).map { |u| attention_user_row(u, nil, nil) }
    end

    # Only approved editors: unconfirmed, hub-less and pending users have their
    # own lists, and someone never approved into a hub was never an editor of it.
    def inactive_users
      users = User.inactive
        .where.not(confirmed_at: nil)
        .where(id: HubMembership.approved.select(:user_id))
        .includes(hub_memberships: :hub)
        .least_recently_seen_first

      render json: {
        threshold_days: User::INACTIVITY_THRESHOLD.in_days.to_i,
        # select on the preloaded association, not .approved, which would re-query per user
        users: users.flat_map { |user| user.hub_memberships.select(&:approved?).map { |m| attention_user_row(user, m.hub.name, m.hub.id) } }
      }
    end

    def destroy_user
      user = User.find_by(id: params[:id])
      return render json: {error: I18n.t(:error_not_found)}, status: :not_found if user.nil?
      return render json: {error: I18n.t(:error_permission)}, status: :forbidden if user == current_user
      # Only accounts nobody relies on yet: unconfirmed, or not a member of any hub
      return render json: {error: I18n.t(:error_user_not_deletable)}, status: :unprocessable_content if user.confirmed? && user.hub_memberships.exists?

      user.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    def move_user_to_hub
      user = User.find_by(id: params[:id])
      target_hub = Hub.find_by(id: params[:hub_id])
      return render json: {error: I18n.t(:error_not_found)}, status: :not_found if user.nil? || target_hub.nil?
      return render json: {error: I18n.t(:error_permission)}, status: :forbidden if user.is_admin

      # Serialises concurrent moves of the same user, which could otherwise leave them in two hubs
      user.with_lock do
        memberships = user.hub_memberships.to_a
        source_hub = memberships.first&.hub
        unless memberships.one? && source_hub != target_hub && source_hub.free? && source_hub.hub_memberships.one?
          return render json: {error: I18n.t(:error_user_not_movable)}, status: :unprocessable_content
        end
        return render json: {error: I18n.t(:error_hub_without_admin)}, status: :unprocessable_content unless target_hub.hub_memberships.approved.admin.exists?
        # Expired trials get deleted with their now-hubless members, so moving someone in would delete their account
        if target_hub.deletion_in_progress? || Hub.eligible_for_deletion.exists?(target_hub.id)
          return render json: {error: I18n.t(:error_hub_deletion_scheduled)}, status: :unprocessable_content
        end

        approved = ActiveModel::Type::Boolean.new.cast(params[:approved]) || false
        memberships.first.destroy!
        target_hub.hub_memberships.create!(user: user, role: :editor, approved: approved)
        LogService.log(:info, "AdminController", "User #{user.id} moved from hub #{source_hub.id} to hub #{target_hub.id} (approved: #{approved}) by #{current_user.email}")
      end
      render json: {message: I18n.t(:message_user_moved)}, status: :ok
    end

    def users_pending_approval
      render json: HubMembership.where(approved: false).includes(:user, :hub).order(created_at: :asc).map { |m| attention_user_row(m.user, m.hub.name, m.hub.id, m.created_at&.iso8601) }
    end

    def super_admins
      users = User.super_admins.order(email: :asc)
      render json: users.map { |u| {id: u.id, email: u.email, admin_write_access: u.admin_write_access, created_at: u.created_at&.iso8601} }
    end

    def upgrade_to_write_admin
      user = User.find_by(id: params[:id])
      return render json: {error: I18n.t(:error_not_found)}, status: :not_found if user.nil?
      return render json: {error: I18n.t(:error_permission)}, status: :forbidden unless user.is_admin && user.confirmed?

      user.update!(admin_write_access: true)
      render json: {message: I18n.t(:message_upgraded)}, status: :ok
    end

    def platform_statistics
      group_by = params[:group_by]
      from = params[:from].present? ? Time.zone.parse(params[:from]) : nil
      to = params[:to].present? ? Time.zone.parse(params[:to]) : nil
      service = PlatformStatisticsService.new(group_by: group_by || "week", from: from, to: to)
      lifecycle = HubLifecycleService.new
      render json: {
        global_counts: service.global_counts.merge(
          hubs_all_time: lifecycle.total_hub_count,
          hubs_churned: lifecycle.churned_hub_count
        ),
        churned_hubs: lifecycle.churned_hubs,
        documents_by_sync_status: service.documents_by_sync_status,
        messages_by_state: service.messages_by_state,
        questions_by_answered: service.questions_by_answered,
        average_answer_times: service.average_answer_times,
        hubs_by_creation_date: service.hubs_by_creation_date(lifecycle.creation_dates)
      }
    end

    def deleted_hub_detail
      summary = HubLifecycleService.new.deleted_hub_summary(params[:id].to_i)
      return render json: {error: I18n.t(:error_not_found)}, status: :not_found if summary.nil?
      render json: summary.merge(activity: HubActivityService.new(params[:id].to_i).timeline)
    end

    def health
      # Get Knowledge Service metrics
      knowledge_service_health = {}
      begin
        knowledge_service_health = KnowledgeService.health
      rescue KnowledgeService::Error => e
        knowledge_service_health = {error: e.message}
      end

      # Get Sidekiq metrics
      stats = Sidekiq::Stats.new
      queues = Sidekiq::Queue.all.map do |q|
        {name: q.name, size: q.size, latency: q.latency}
      end
      processes = Sidekiq::ProcessSet.new.size

      # Check health status
      sidekiq_healthy = processes > 0 &&
        stats.enqueued < 1000 &&
        queues.all? { |q| q[:size] < 1000 && q[:latency] < 300 }

      knowledge_service_healthy = !knowledge_service_health["error"] &&
        knowledge_service_health["active_workers"].to_i > 0 &&
        knowledge_service_health["enqueued_jobs"].to_i < 1000

      healthy = sidekiq_healthy && knowledge_service_healthy

      render json: {
        status: healthy ? "ok" : "warning",
        sidekiq: {
          processed: stats.processed,
          failed: stats.failed,
          enqueued: stats.enqueued,
          retry_size: Sidekiq::RetrySet.new.size,
          dead_size: Sidekiq::DeadSet.new.size,
          processes: processes,
          queues: queues
        },
        knowledge_service_rq: knowledge_service_health
      }, status: healthy ? 200 : 503
    end

    private

    def message_reports_scope(hub)
      hub ? MessageReport.in_hub(hub) : MessageReport.all
    end

    # One row shape for both the JSON table and the CSV export, so they never drift apart
    def message_report_row(report)
      message = report.message
      conversation = message&.conversation
      {
        id: report.id,
        hub_id: conversation&.hub_id,
        hub_name: conversation&.hub&.name,
        message_id: report.message_id,
        message_link: message&.permalink,
        platform: conversation&.platform,
        user_question: message&.reply_to&.body,
        message_body: message&.body,
        message_sent_at: message&.created_at&.iso8601,
        reported_by_email: report.reported_by&.email,
        comment: report.comment,
        created_at: report.created_at&.iso8601
      }
    end

    def create_hub_params
      params.require(:hub).permit(:name, :plan)
    end

    def single_hub_aggregates(hub)
      # Integer enum constants interpolated into SQL — safe, not derived from user input
      doc_count, doc_last_at, doc_errors = Document.joins(:source)
        .where(sources: {hub_id: hub.id})
        .pick(
          Arel.sql("COUNT(*)"),
          Arel.sql("MAX(documents.created_at)"),
          Arel.sql("COUNT(*) FILTER (WHERE documents.sync_status = #{Document.sync_statuses[:error]})")
        )

      internal_platform = Conversation.platforms[:internal]
      conv_internal_at, conv_external_at = Conversation.where(hub_id: hub.id)
        .pick(
          Arel.sql("MAX(updated_at) FILTER (WHERE platform = #{internal_platform})"),
          Arel.sql("MAX(updated_at) FILTER (WHERE platform != #{internal_platform})")
        )

      {
        memberships_count_by_hub: {hub.id => HubMembership.where(hub_id: hub.id).count},
        unconfirmed_editors_by_hub: {hub.id => HubMembership.joins(:user).where(hub_id: hub.id, users: {confirmed_at: nil}).count},
        unapproved_editors_by_hub: {hub.id => HubMembership.joins(:user).where(hub_id: hub.id, approved: false).where.not(users: {confirmed_at: nil}).count},
        active_users_by_hub: {hub.id => ExternalUser.active.where(hub_id: hub.id).count},
        sources_by_hub: {hub.id => Source.where(hub_id: hub.id).count},
        documents_by_hub: {hub.id => doc_count},
        last_document_by_hub: {hub.id => doc_last_at},
        document_errors_by_hub: {hub.id => doc_errors},
        last_internal_conversation_by_hub: {hub.id => conv_internal_at},
        last_external_conversation_by_hub: {hub.id => conv_external_at}
      }
    end

    def hub_aggregates
      # Integer enum constants interpolated into SQL — safe, not derived from user input
      internal_platform = Conversation.platforms[:internal]
      doc_rows = Document.joins(:source).group("sources.hub_id").pluck(
        Arel.sql("sources.hub_id"),
        Arel.sql("COUNT(*)"),
        Arel.sql("MAX(documents.created_at)"),
        Arel.sql("COUNT(*) FILTER (WHERE documents.sync_status = #{Document.sync_statuses[:error]})")
      )
      docs_by_hub = {}
      last_doc_by_hub = {}
      doc_errors_by_hub = {}
      doc_rows.each do |hub_id, count, last_at, errors|
        docs_by_hub[hub_id] = count
        last_doc_by_hub[hub_id] = last_at
        doc_errors_by_hub[hub_id] = errors
      end

      conv_rows = Conversation.group(:hub_id).pluck(
        :hub_id,
        Arel.sql("MAX(updated_at) FILTER (WHERE platform = #{internal_platform})"),
        Arel.sql("MAX(updated_at) FILTER (WHERE platform != #{internal_platform})")
      )
      conv_internal_by_hub = {}
      conv_external_by_hub = {}
      conv_rows.each do |hub_id, internal_at, external_at|
        conv_internal_by_hub[hub_id] = internal_at
        conv_external_by_hub[hub_id] = external_at
      end

      {
        memberships_count_by_hub: HubMembership.group(:hub_id).count,
        unconfirmed_editors_by_hub: HubMembership.joins(:user).where(users: {confirmed_at: nil}).group(:hub_id).count,
        unapproved_editors_by_hub: HubMembership.joins(:user).where(approved: false).where.not(users: {confirmed_at: nil}).group(:hub_id).count,
        active_users_by_hub: ExternalUser.active.group(:hub_id).count,
        sources_by_hub: Source.group(:hub_id).count,
        documents_by_hub: docs_by_hub,
        last_document_by_hub: last_doc_by_hub,
        document_errors_by_hub: doc_errors_by_hub,
        last_internal_conversation_by_hub: conv_internal_by_hub,
        last_external_conversation_by_hub: conv_external_by_hub
      }
    end

    def hub_row(hub, aggregates)
      {
        id: hub.id,
        name: hub.name,
        organization_name: hub.organization&.name,
        plan: hub.plan,
        trial_active: hub.trial_active?,
        trial_expired: hub.trial_expired?,
        trial_ends_at: hub.trial_ends_at&.iso8601,
        invite_code: hub.invite_code,
        created_at: hub.created_at&.iso8601,
        users_count: aggregates[:memberships_count_by_hub][hub.id] || 0,
        unconfirmed_editors_count: aggregates[:unconfirmed_editors_by_hub][hub.id] || 0,
        unapproved_editors_count: aggregates[:unapproved_editors_by_hub][hub.id] || 0,
        active_external_users_count: aggregates[:active_users_by_hub][hub.id] || 0,
        max_messages: hub.max_messages_for_plan,
        sources_count: aggregates[:sources_by_hub][hub.id] || 0,
        document_errors_count: aggregates[:document_errors_by_hub][hub.id] || 0,
        max_sources: hub.max_sources_for_plan,
        documents_count: aggregates[:documents_by_hub][hub.id] || 0,
        last_document_added_at: aggregates[:last_document_by_hub][hub.id]&.iso8601,
        max_documents: hub.max_documents_for_plan,
        last_internal_conversation_at: aggregates[:last_internal_conversation_by_hub][hub.id]&.iso8601,
        last_external_conversation_at: aggregates[:last_external_conversation_by_hub][hub.id]&.iso8601,
        trial_emails_enabled: hub.trial_emails_enabled,
        deletion_requested_at: hub.deletion_requested_at&.iso8601,
        custom_limits: hub.custom_limits,
        whatsapp_phone: hub.messaging_integrations.find { |m| m.platform == "whatsapp" && m.active? }&.get_credential(:phone_number),
        telegram_username: hub.messaging_integrations.find { |m| m.platform == "telegram" && m.active? }&.get_credential("bot_username"),
        signal_phone: hub.messaging_integrations.find { |m| m.platform == "signal" && m.active? }&.get_credential(:phone_number)
      }
    end

    def attention_user_row(user, hub_name, hub_id, requested_at = nil)
      {id: user.id, email: user.email, hub_name: hub_name, hub_id: hub_id, created_at: user.created_at&.iso8601, requested_at: requested_at, last_login_at: user.last_login_at&.iso8601, last_active_at: user.last_active_at&.iso8601}
    end
  end
end
