module SmartPagination
  extend ActiveSupport::Concern

  private

  def paginate(collection, total_count = nil)
    if params[:around_id].present? || params[:window_size].present? || params[:anchor].present?
      paginate_around_record(collection)
    else
      standard_paginate(collection, total_count)
    end
  end

  def standard_paginate(collection, total_count = nil)
    per_page = (params[:per_page].presence&.to_i || 100).clamp(1, 100)
    total_count ||= collection.count
    last_page = (total_count.to_f / per_page).ceil
    page = params[:page] || last_page
    sort_by = params[:sort_by] || "updated_at"
    sort_by = sanitize_sort_by(sort_by)
    sort_direction = sanitize_sort_direction(params[:sort_direction])
    collection = apply_custom_sort(collection, sort_by, sort_direction)
    collection_order = has_custom_order?(collection) ? collection : collection.order(sort_by => sort_direction, :id => sort_direction)
    paginated = collection_order.page(page).per(per_page)

    {
      data: paginated,
      pagination: {
        current_page: paginated.current_page,
        per_page: paginated.limit_value,
        total_pages: last_page,
        total_count: total_count,
        next_page: paginated.next_page,
        prev_page: paginated.prev_page,
        first_page: paginated.first_page?,
        last_page: paginated.last_page?
      }
    }
  end

  # Hook: a controller can return the collection already ordered to skip the default sort_by/id order
  def apply_custom_sort(collection, _sort_by, _sort_direction)
    collection
  end

  def has_custom_order?(collection)
    collection.order_values.any?
  end

  def paginate_around_record(collection)
    window_size = (params[:window_size].presence&.to_i || 20).clamp(1, 100)
    sort_by = params[:sort_by] || "updated_at"
    sort_by = sanitize_sort_by(sort_by)
    sort_direction = sanitize_sort_direction(params[:sort_direction])

    ordered = apply_custom_sort(collection, sort_by, sort_direction)
    return paginate_around_ordered(collection, ordered, window_size) if has_custom_order?(ordered)

    # Without around_id the window starts at the first record in sort order, or the last with anchor=last
    edge_direction = (params[:anchor] == "last") ? opposite_sort_direction(sort_direction) : sort_direction
    target_record = collection.find_by(id: params[:around_id].to_i) if params[:around_id].present?
    # An around_id outside the collection, such as one a filter left out, gets the edge window too
    target_record ||= collection.order(sort_by => edge_direction, "id" => edge_direction).first
    return standard_paginate(collection) unless target_record

    # Get items around the target record
    items_around = find_items_around_target(
      collection,
      target_record,
      sort_by,
      sort_direction,
      window_size
    )

    {
      data: items_around[:items],
      pagination: {
        type: "permalink",
        total_count: collection.count,
        window_size: items_around[:items].count,
        target_record_id: target_record.id,
        target_position: items_around[:target_position],
        has_previous: items_around[:has_previous],
        has_next: items_around[:has_next],
        first_record_id: items_around[:items].first&.id,
        last_record_id: items_around[:items].last&.id
      }
    }
  end

  # A custom order is an expression, not a column to compare the target's value with, so the window is cut
  # from the ids in that order instead
  def paginate_around_ordered(collection, ordered, window_size)
    ids = ordered.pluck(:id).uniq
    record_id = params[:around_id]&.to_i
    record_id = ((params[:anchor] == "last") ? ids.last : ids.first) unless ids.include?(record_id)
    position = ids.index(record_id)
    return standard_paginate(collection) unless position

    half_window = window_size / 2
    first = [position - half_window, 0].max
    window_ids = ids[first..(position + half_window)]
    records = ordered.where(id: window_ids).index_by(&:id)
    items = window_ids.filter_map { |id| records[id] }

    {
      data: items,
      pagination: {
        type: "permalink",
        total_count: ids.size,
        window_size: items.size,
        target_record_id: record_id,
        target_position: position - first + 1,
        has_previous: first > 0,
        has_next: position + half_window < ids.size - 1,
        first_record_id: items.first&.id,
        last_record_id: items.last&.id
      }
    }
  end

  def find_items_around_target(collection, target_record, sort_by, sort_direction, window_size)
    attribute_name = sort_by.split(".").last
    target_value = target_record.send(attribute_name)
    target_value = target_record.send("#{attribute_name}_before_type_cast") if target_value.is_a?(String)
    half_window = window_size / 2
    # Compared as (value, id) to match the order below; on the value alone, ties land on the wrong side of the target
    id_column = "#{collection.table_name}.id"

    # Items before target
    before_operator = (sort_direction == "desc") ? ">" : "<"
    before_order = (sort_direction == "desc") ? "asc" : "desc"

    before_items = collection
      .where("(#{sort_by}, #{id_column}) #{before_operator} (?, ?)", target_value, target_record.id)
      .order("#{sort_by} #{before_order}, id #{before_order}")
      .limit(half_window)
      .to_a

    # Reverse to get proper order
    before_items.reverse! if sort_direction == "desc"

    # Items after target
    after_operator = (sort_direction == "desc") ? "<" : ">"

    after_items = collection
      .where("(#{sort_by}, #{id_column}) #{after_operator} (?, ?)", target_value, target_record.id)
      .order("#{sort_by} #{sort_direction}, id #{sort_direction}")
      .limit(half_window)
      .to_a

    # Combine all items
    all_items = before_items + [target_record] + after_items

    # Sort everything properly
    all_items.sort_by! do |item|
      value = item.send(attribute_name)
      [{"true" => 1, "false" => 0}[value.to_s] || value, item.id]
    end
    all_items.reverse! if sort_direction == "desc"

    {
      items: all_items,
      target_position: all_items.index(target_record) + 1,
      has_previous: before_items.count >= half_window,
      has_next: after_items.count >= half_window
    }
  end

  ALLOWED_SORT_COLUMNS = %w[
    created_at updated_at platform participant_id messages_count
    title content published_at last_summary_updated_by_id name sync_status
    priority_tier
  ].freeze

  ALLOWED_SORT_TABLES = %w[conversations contributions].freeze

  def sanitize_sort_by(sort_by)
    value = sort_by.to_s
    if value.include?(".")
      table, column = value.split(".", 2)
      return value if ALLOWED_SORT_TABLES.include?(table) && ALLOWED_SORT_COLUMNS.include?(column)
    elsif ALLOWED_SORT_COLUMNS.include?(value)
      return value
    end
    "updated_at"
  end

  def opposite_sort_direction(direction)
    (direction == "desc") ? "asc" : "desc"
  end

  def sanitize_sort_direction(direction)
    %w[asc desc].include?(direction.to_s.downcase) ? direction.to_s.downcase : "desc"
  end
end
