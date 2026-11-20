class Api::AboutController < ApplicationController
  before_action :authenticate_user!

  include ActionView::Helpers::NumberHelper
  def index
    about = {
      google_drive_share_email: SourceIngestors::GoogleDriveFolder.share_email,
      # This is meant to be public - the Google Picker runs in the browser and needs them. They grant no
      # access on their own: the OAuth client only works from our origins, and the API key is
      # restricted to the Picker API (a referrer restriction breaks Firefox, so it isn't used).
      google_oauth_client_id: ENV["GOOGLE_OAUTH_CLIENT_ID"].presence,
      google_picker_api_key: ENV["GOOGLE_PICKER_API_KEY"].presence,
      google_picker_app_id: ENV["GOOGLE_PICKER_APP_ID"].presence,
      max_file_size: number_to_human_size(SourceIngestors::FileConstraints::MAX_SIZE_BYTES),
      allowed_extensions: SourceIngestors::FileConstraints::ALLOWED_EXTENSIONS.map(&:upcase).join(", "),
      max_files_per_upload: SourceIngestors::UploadedFiles::MAX_FILES_PER_UPLOAD,
      max_summary_length: Document::MAX_SUMMARY_LENGTH,
      max_topic_name_length: Topicable::MAX_TOPIC_NAME_LENGTH,
      max_resource_question_length: ExternalResource::MAX_QUESTION_LENGTH,
      max_resource_description_length: ExternalResource::MAX_DESCRIPTION_LENGTH,
      hub_trial_length_days: ENV.fetch("HUB_TRIAL_LENGTH_DAYS", "30").to_i,
      conversation_inactivity_timeout_minutes: Conversation.inactivity_timeout.in_minutes.to_i,
      schedule_demo_link: AppInfo.schedule_demo_link,
      plans: build_plans_data,
      languages: build_languages_data,
      sms_countries: build_sms_countries_data
    }
    render json: about
  end

  private

  def build_sms_countries_data
    SmsMessagingIntegration::SUPPORTED_COUNTRIES.map do |code, name|
      {code: code, name: name, number_types: SmsMessagingIntegration.number_types_for(code)}
    end
  end

  def build_plans_data
    {
      trial: {
        messages: PlanRestrictions::PLAN_LIMITS[:messages][:free],
        sources: PlanRestrictions::PLAN_LIMITS[:sources][:free],
        documents: PlanRestrictions::PLAN_LIMITS[:documents][:free]
      },
      subsidized: {
        messages: PlanRestrictions::PLAN_LIMITS[:messages][:subsidized],
        sources: PlanRestrictions::PLAN_LIMITS[:sources][:subsidized],
        documents: PlanRestrictions::PLAN_LIMITS[:documents][:subsidized]
      },
      standard: {
        messages: PlanRestrictions::PLAN_LIMITS[:messages][:standard],
        sources: PlanRestrictions::PLAN_LIMITS[:sources][:standard],
        documents: PlanRestrictions::PLAN_LIMITS[:documents][:standard]
      },
      pro: {
        messages: PlanRestrictions::PLAN_LIMITS[:messages][:pro],
        sources: PlanRestrictions::PLAN_LIMITS[:sources][:pro],
        documents: PlanRestrictions::PLAN_LIMITS[:documents][:pro]
      },
      enterprise: {
        messages: PlanRestrictions::PLAN_LIMITS[:messages][:enterprise],
        sources: PlanRestrictions::PLAN_LIMITS[:sources][:enterprise],
        documents: PlanRestrictions::PLAN_LIMITS[:documents][:enterprise]
      }
    }
  end

  def build_languages_data
    SUPPORTED_LANGUAGES.map { |code, name| {code: code, name: name} }
  end
end
