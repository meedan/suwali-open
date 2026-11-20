# Run with: bundle exec rails runner benchmark_website_configure.rb
require "json"

RANDOM_SOURCES = [
  # WordPress
  "https://www.searchenginejournal.com/category/news/page/2/",
  "https://css-tricks.com/page/2/",
  "https://managewp.com/blog/page/2",
  "https://stratechery.com/archive/?page=2",
  # Substack
  "https://www.construction-physics.com/archive/?page=2",
  "https://www.noahpinion.blog/archive?sort=new&page=2",
  # Custom
  "https://www.engadget.com/page/2/",
  "https://www.garbageday.email/archive?sort=new&page=2",
  "https://www.polygon.com/archives/2",
  "https://www.technologyreview.com/page/2/",
  # Ghost
  "https://www.404media.co/page/2/"
]

SUWALI_SOURCES = [
  # WordPress
  "https://theruju.com/category/recent-fact-check",
  "https://www.omgyno.com/",
  "https://avdi.codes/banana-stand/?query-0-page=2",
  "https://chekia.unitec.edu/iverify-reports/page/2/",
  # Custom
  "https://lvivmediaforum.com/en/category/events-and-opportunities",
  "https://www.arkansasonline.com/",
  "https://www.w3.org/news/?page=2",
  # Drupal
  "https://alsifr.org/kam-kaif?page=2",
  "https://chequeabolivia.bo/taxonomy/term/273",
  # Webflow
  "https://meedan.com/blog?6f143882_page=2",
  # Ghost
  "https://selfh.st/archive/page/2/"
]

SOURCES = (RANDOM_SOURCES + SUWALI_SOURCES).map { |url| {url: url} }

WEBSITE_HELPER = SourceIngestors::Website.new({})

def run_preview(listing_url, link_selector, title_selector, body_selector)
  unless link_selector && title_selector && body_selector
    missing = [:link, :title, :body].zip([link_selector, title_selector, body_selector])
      .select { |_, v| v.nil? }.map { |k, _| k }.join(", ")
    return {success: false, error: "nil selectors: #{missing}", first_doc: nil}
  end

  site = SourceIngestors::Website.new(
    "base_url" => listing_url,
    "post_link_selector" => link_selector,
    "title_selector" => title_selector,
    "body_selector" => body_selector,
    "limit" => 2,
    :hub_id => nil
  )
  docs, = site.preview
  if docs.size > 1
    {success: true, error: nil, first_doc: docs.first}
  elsif docs.size == 1
    {success: false, error: "only 1 article fetched", first_doc: docs.first}
  else
    {success: false, error: "no documents returned", first_doc: nil}
  end
rescue => e
  {success: false, error: e.message, first_doc: nil}
end

original_log = LogService.method(:log)
LogService.define_singleton_method(:log) do |level, source, message|
  if source == "SelectorDetector" && level == :info
    (Thread.current[:captured_tokens] ||= []) << {
      input: message[/input_tokens=(\d+)/, 1].to_i,
      output: message[/output_tokens=(\d+)/, 1].to_i
    }
    Thread.current[:last_link_attempt] = message[/\Alink — selector=(.+?) model=/, 1] if message.start_with?("link —")
  end
  original_log.call(level, source, message)
end

THREAD_COUNT = 4

queue = Queue.new
SOURCES.each_with_index { |source, i| queue << [source, i] }

mutex = Mutex.new
results = Array.new(SOURCES.size)

def run_source(source)
  listing_url = source[:url]
  http = SourceIngestors::HttpClient.new(hub_id: nil)
  detector = SourceIngestors::SelectorDetector.new
  t0 = Time.now

  listing_resp = http.get(listing_url)
  return {url: listing_url, error: "listing fetch failed (#{listing_resp.code})"} unless listing_resp.success?

  link_selector = detector.detect_link(listing_resp.body)
  return {url: listing_url, error: "no link selector (llm returned: #{Thread.current[:last_link_attempt].inspect})"} unless link_selector

  article_url = WEBSITE_HELPER.send(:resolve_article_url, listing_resp.body, link_selector, listing_url)
  return {url: listing_url, error: "no article URL resolved from #{link_selector.inspect}"} unless article_url

  article_resp = http.get(article_url)
  return {url: listing_url, error: "article fetch failed (#{article_resp.code})"} unless article_resp.success?

  article = detector.detect_article(article_resp.body)
  elapsed_ms = ((Time.now - t0) * 1000).round
  tokens = Thread.current[:captured_tokens].dup
  preview = run_preview(listing_url, link_selector, article[:title], article[:body])

  {
    url: listing_url,
    detected_platform: article[:platform],
    link: link_selector,
    title: article[:title],
    body: article[:body],
    elapsed_ms: elapsed_ms,
    tokens: {input: tokens.sum { _1[:input] }, output: tokens.sum { _1[:output] }},
    preview: preview
  }
rescue => e
  {url: listing_url, error: e.message}
end

threads = THREAD_COUNT.times.map do
  Thread.new do
    until queue.empty?
      item = begin; queue.pop(true); rescue ThreadError; nil; end
      next unless item
      source, i = item

      Thread.current[:captured_tokens] = []
      Thread.current[:last_link_attempt] = nil

      result = run_source(source)
      mutex.synchronize { results[i] = result }
    end
  end
end

threads.each(&:join)

puts "\n#{"=" * 70}"
puts "WEBSITE CONFIGURE BENCHMARK"
puts "=" * 70

results.each do |r|
  puts "\nURL: #{r[:url]}"
  if r[:error]
    puts "  ERROR: #{r[:error]}"
    next
  end

  puts "  platform: #{r[:detected_platform]}"
  puts "  link:     #{r[:link].inspect}"
  puts "  title:    #{r[:title].inspect}"
  puts "  body:     #{r[:body].inspect}"
  puts "  tokens:   #{r[:tokens][:input]} in / #{r[:tokens][:output]} out  (#{r[:elapsed_ms]}ms)"
  pv = r[:preview]
  icon = pv[:success] ? "✓" : "✗"
  puts "  preview:  #{icon} #{pv[:error]}" if pv[:error]
  puts "  preview:  #{icon}" unless pv[:error]
  if pv[:first_doc]
    title_str = pv[:first_doc][:title].to_s[0, 60]
    content_str = pv[:first_doc][:content].to_s.gsub(/\s+/, " ")[0, 120]
    puts "            #{title_str.inspect}"
    puts "            #{content_str.inspect}"
  end
end

output_path = Rails.root.join("tmp", "website_configure_benchmark_#{Time.now.strftime("%Y%m%d_%H%M%S")}.json")
File.write(output_path, JSON.pretty_generate(results))
puts "\nResults saved to #{output_path}"

ok = results.reject { _1[:error] }
puts "\n#{"=" * 70}"
puts "SUMMARY (#{ok.size}/#{results.size} completed)"
puts "=" * 70
if ok.any?
  preview_ok = ok.count { _1[:preview][:success] }
  avg_ms = (ok.sum { _1[:elapsed_ms] } / ok.size.to_f).round
  avg_in = (ok.sum { _1[:tokens][:input] } / ok.size.to_f).round
  avg_out = (ok.sum { _1[:tokens][:output] } / ok.size.to_f).round
  puts "  preview success: #{preview_ok}/#{ok.size}"
  puts "  avg elapsed:     #{avg_ms}ms"
  puts "  avg tokens:      #{avg_in} in / #{avg_out} out"
  puts ""
  puts "  by detected platform:"
  ok.group_by { _1[:detected_platform] }.sort.each do |platform, group|
    pv_ok = group.count { _1[:preview][:success] }
    puts "    #{platform.ljust(10)} (#{group.size}) — preview: #{pv_ok}/#{group.size}"
  end
end
