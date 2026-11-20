path = Rails.root.join("config", "public_email_domains.txt")

PUBLIC_EMAIL_DOMAINS_LIST = Set.new(
  File.readlines(path, chomp: true)
      .map { |d| d.strip.downcase }
      .reject { |d| d.empty? || d.start_with?("#") }
).freeze
