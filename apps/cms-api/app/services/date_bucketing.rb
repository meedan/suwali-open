# Zero-filled statistics series over a date range, so series built by different queries line up
# bucket by bucket. Expects the including service to set @from, @to and a validated @group_by.
module DateBucketing
  MAX_DATE_RANGE = 2.years

  private

  def clamped_from(from)
    return from if @to - from <= MAX_DATE_RANGE

    LogService.log(:info, self.class.name, "Date range exceeds max, clamping requested range #{from.to_date} to #{@to.to_date}")
    @to - MAX_DATE_RANGE
  end

  # {bucket_date => count}
  def by_bucket(query, field = "created_at", count = nil)
    counts = query.where(field => @from..@to).group(bucket_expression(field)).count(count)
    counts = counts.transform_keys { |key| bucket_key(key) }
    bucket_range.index_with { |key| counts.fetch(key, 0) }
  end

  # {key => {bucket_date => count}}, from a GROUP BY key, bucket
  def series_by_key(counts)
    counts.each_with_object({}) do |((key, bucket), count), series|
      series[key] ||= empty_series
      series[key][bucket_key(bucket)] = count
    end
  end

  # [{date, key => count, …}], from a GROUP BY bucket, key — what a stacked chart reads directly
  def pivot_by_bucket(rows, empty_bucket)
    buckets = bucket_range
    pivoted = buckets.index_with { empty_bucket.dup }
    rows.each do |(bucket, key), count|
      date = bucket_key(bucket)
      next unless pivoted.key?(date) && pivoted[date].key?(key)
      pivoted[date][key] = count
    end
    buckets.map { |bucket| pivoted[bucket].merge("date" => bucket) }
  end

  def bucket_expression(field)
    case @group_by
    when "range" then "NULL::timestamp"
    when "rolling_week" then rolling_week_expression(field)
    else "DATE_TRUNC('#{@group_by}', #{field})"
    end
  end

  # Seven-day buckets counted from the start of the window rather than from Monday, so every bucket
  # holds a whole week and the newest one can end yesterday instead of part-way through today.
  def rolling_week_expression(field)
    start = ActiveRecord::Base.connection.quote(@from.to_date)
    "(DATE #{start} + (((#{field})::date - DATE #{start}) / 7) * 7)"
  end

  def bucket_key(value)
    (@group_by == "range") ? @from.to_date.iso8601 : value.to_date.iso8601
  end

  # Buckets are labelled by the date they start on, so the first and last one can be partial when
  # the requested range does not line up with week/month boundaries.
  def bucket_range
    return [@from.to_date.iso8601] if @group_by == "range"

    current = truncate_date(@from.to_date)
    buckets = []
    while current <= @to.to_date
      buckets << current.iso8601
      current = advance(current)
    end
    buckets
  end

  def truncate_date(date)
    case @group_by
    when "day", "rolling_week" then date
    when "week" then date.beginning_of_week
    when "month" then date.beginning_of_month
    end
  end

  def advance(date)
    case @group_by
    when "day" then date + 1.day
    when "week", "rolling_week" then date + 1.week
    when "month" then date + 1.month
    end
  end

  def empty_series
    bucket_range.index_with { 0 }
  end
end
