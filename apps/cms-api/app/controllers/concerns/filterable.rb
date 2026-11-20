module Filterable
  extend ActiveSupport::Concern

  private

  def apply_filters(collection)
    filtered_collection = collection

    filter_mappings.each do |param_name, filter_config|
      next unless params.has_key?(param_name)

      filtered_collection = apply_filter(
        filtered_collection,
        param_name,
        params[param_name],
        filter_config
      )
    end

    filtered_collection
  end

  def apply_filter(collection, param_name, param_value, filter_config)
    # Reset the filter
    return collection if param_value.to_sym == filter_config[:reset_value]&.to_sym
    result = if filter_config[:type] == :mapped
      # Maps URL parameter value to a database column with optional value transformation
      # Example: status=paused -> active=false
      column = filter_config[:column]
      value = filter_config[:values] ? filter_config[:values][param_value.to_sym] : param_value
      collection.where(column => value)
    elsif filter_config[:type] == :custom
      # Calls a custom filter method defined in the controller
      # Example: filter_by_status(collection, param_value)
      method_name = filter_config[:method]
      send(method_name, collection, param_value)
    end
    result || collection
  end

  # Define this method in your controller to define custom filter mappings
  # Example:
  #   def custom_filter_mappings
  #     {
  #       status: {
  #         type: :mapped,
  #         column: :active,
  #         values: {
  #           active: true,
  #           paused: false
  #         }
  #       },
  #       search: {
  #         type: :custom,
  #         method: :filter_by_search
  #       }
  #     }
  #   end

  def filter_mappings
    {
      status: {
        type: :mapped,
        column: :active,
        reset_value: :all,
        values: {
          active: true,
          paused: false
        }
      },
      date_modified: {
        type: :custom,
        method: :filter_by_date_modified,
        reset_value: :any
      },
      notebooks: {
        type: :custom,
        method: :filter_by_inclusion_in_notebooks,
        reset_value: :all
      },
      sync_status: {
        type: :custom,
        method: :filter_by_sync_status,
        reset_value: :any
      },
      priority_tier: {
        type: :mapped,
        column: :priority_tier,
        reset_value: :all
      }
    }.merge(custom_filter_mappings)
  end

  def filter_by_date(collection, field, value)
    now = Time.current

    range =
      case value.to_sym
      when :today
        now.beginning_of_day..now
      when :yesterday
        now.yesterday.beginning_of_day..now.yesterday.end_of_day
      when :last_7_days
        7.days.ago..now
      when :last_30_days
        30.days.ago..now
      when :last_90_days
        90.days.ago..now
      when :more_than_90
        ..90.days.ago
      end

    return collection if range.blank?
    collection.where(field => range)
  end

  def filter_by_date_modified(collection, value)
    filter_by_date(collection, :updated_at, value)
  end

  def filter_by_inclusion_in_notebooks(collection, value)
    result = collection
    if value.to_s == "true"
      items = NotebookItem.where(item_type: collection.klass.polymorphic_name)
      result = collection.where(items.where(NotebookItem.arel_table[:item_id].eq(collection.klass.arel_table[:id])).arel.exists)
    elsif value.to_s == "false"
      result = collection.left_joins(:notebook_items).where(notebook_items: {id: nil})
    end
    result
  end

  def topics_filter_mapping
    {
      topics: {
        type: :custom,
        method: :filter_by_topics,
        reset_value: :any
      }
    }
  end

  # Topic ids aren't checked against the hub: TopicItem#item_in_topic_hub keeps another hub's topics off its items
  def filter_by_topics(collection, value)
    tokens = value.to_s.split(",").map { |token| token.strip.downcase }
    ids = tokens.filter_map { |token| Integer(token, exception: false) }.uniq
    untagged = tokens.include?("none")
    return collection if ids.empty? && !untagged

    matching = [(collection.tagged_with(ids) if ids.any?), (collection.untagged if untagged)].compact.reduce(:or)
    (params[:topics_mode].to_s == "exclude") ? collection.where.not(id: matching.select(:id)) : matching
  end

  def filter_by_sync_status(collection, value)
    statuses = value.split(",").select { |status| !status.blank? }.collect { |status| status.strip.downcase }
    return collection if statuses.empty?
    # "unsupported" is a UI-only pseudo-status (skipped files that never became records); drop it and any
    # unknown value. A non-empty selection that maps to no real statuses must match nothing, not everything.
    valid_statuses = statuses & collection.klass.sync_statuses.keys
    collection.where(sync_status: valid_statuses)
  end

  # Unknown values are dropped, so a selection of only unknown values matches nothing, as in filter_by_sync_status
  def filter_by_participant_type(collection, value)
    types = value.to_s.split(",").map { |type| type.strip.downcase }.reject(&:blank?)
    return collection if types.empty?

    trusted = []
    trusted << false if types.include?("anonymous")
    trusted << true if types.include?("trusted")
    collection.from_end_users(trusted: trusted)
  end
end
