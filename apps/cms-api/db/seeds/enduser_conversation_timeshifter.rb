# Rewrites every timestamp in a snapshot so the newest one lands at import time and the whole
# timeline fits into the last RECENT_WINDOW. This runs on import rather than on export because the
# snapshot YAML is committed and reseeded for months — dates baked in at export time are stale the
# week after.
#
# Ordering is always preserved. Gaps up to MAX_PRESERVED_GAP are kept exactly, so the back-and-forth
# inside a conversation keeps its real timing; only the long silences between conversations are
# squeezed to make the timeline fit.
class EnduserConversationTimeshifter
  RECENT_WINDOW = 30.days.to_i
  MAX_PRESERVED_GAP = 6.hours.to_i

  def initialize(now: Time.current)
    @now = now
  end

  def shift(data)
    timestamps = data.values.flatten.flat_map { |row| row.values.grep(Time) }.uniq.sort
    return data if timestamps.size < 2

    mapping = build_mapping(timestamps)
    data.transform_values do |rows|
      rows.map { |row| row.transform_values { |value| value.is_a?(Time) ? mapping[key(value)] : value } }
    end
  end

  private

  # Times equal to the microsecond can be distinct objects across rows, so index by exact value.
  def key(time)
    time.to_r
  end

  def build_mapping(timestamps)
    new_gaps = compress(timestamps.each_cons(2).map { |earlier, later| later - earlier })

    current = @now - new_gaps.sum
    mapping = {key(timestamps.first) => current}
    timestamps.drop(1).each_with_index do |timestamp, index|
      current += new_gaps[index]
      mapping[key(timestamp)] = current
    end
    mapping
  end

  def compress(gaps)
    total = gaps.sum
    return gaps if total <= RECENT_WINDOW

    excesses = gaps.map { |gap| [gap - MAX_PRESERVED_GAP, 0].max }
    budget = RECENT_WINDOW - (total - excesses.sum)
    # The gaps we wanted to keep intact already overflow the window on their own, so nothing can be
    # preserved: scale everything down evenly instead.
    return gaps.map { |gap| gap * RECENT_WINDOW / total } if budget <= 0

    scale = budget / excesses.sum.to_f
    gaps.zip(excesses).map { |gap, excess| gap - excess + (excess * scale) }
  end
end
