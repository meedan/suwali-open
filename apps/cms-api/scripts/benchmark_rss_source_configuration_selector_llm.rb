#!/usr/bin/env ruby
# frozen_string_literal: true

#
# Benchmark: LLM CSS selector detection
#   local_html    — cleaned body HTML passed to model
#   skeleton_html — structural skeleton only (text nodes removed, unidentifiable elements unwrapped)
#
# Usage: bundle exec ruby scripts/benchmark_rss_source_configuration_selector_llm.rb

require "bundler/setup"
require "ruby_llm"
require "ruby_llm/schema"
require "nokogiri"
require "httparty"
require "feedjira"
require "json"

# ── Config ─────────────────────────────────────────────────────────────────────

MODEL = "gpt-4o-mini"
HTML_MAX_CHARS = 40_000
APPROACHES = %w[local_html skeleton_html].freeze

TEST_FEEDS = %w[
  https://espanol.leadstories.com/atom.xml
  https://chicago.suntimes.com/rss/immigration/index.xml
  https://chicago.suntimes.com/rss/immigration/index.xml
  https://leadstories.com/atom.xml
  https://www.factcheck.org/feed/
  https://www.factcheck.org/es/feed/
  http://kashif.ps/feed/
  https://www.piyaoba.org/feed/
  https://cddfactcheck.org/feed/
].freeze

# https://developers.openai.com/api/docs/pricing
MODEL_PRICING = {
  "gpt-4o-mini" => {input: 0.15, output: 0.60},
  "gpt-4o" => {input: 2.50, output: 10.00},
  "gpt-4.1" => {input: 2.00, output: 8.00}
}.freeze

# ── Setup ──────────────────────────────────────────────────────────────────────

RubyLLM.configure do |c|
  c.openai_api_key = ENV.fetch("OPENAI_API_KEY") { abort "OPENAI_API_KEY is not set" }
end

class ContentSelectorSchema < RubyLLM::Schema
  string :selector, description: "CSS selector for the main article body, e.g. 'article.post-content', '.entry-body'"
end

# ── HTML helpers ───────────────────────────────────────────────────────────────

def first_article_url(feed_url)
  res = HTTParty.get(feed_url,
    headers: {"User-Agent" => "Mozilla/5.0 (compatible; SuwaliBot/1.0)"},
    follow_redirects: true, timeout: 15)
  raise "HTTP #{res.code}" unless res.success?
  entry = Feedjira.parse(res.body).entries.first
  raise "Feed has no entries" if entry.nil?
  entry.url.to_s.strip
end

def fetch_html(url)
  res = HTTParty.get(url,
    headers: {"User-Agent" => "Mozilla/5.0 (compatible; SuwaliBot/1.0)", "Accept" => "text/html"},
    follow_redirects: true, timeout: 15)
  raise "HTTP #{res.code}" unless res.success?
  res.body
end

def prepare_body(raw_html)
  doc = Nokogiri::HTML(raw_html)
  body = doc.at_css("body") || doc
  %w[script style noscript svg iframe header footer nav aside form figure picture video audio].each { |t| body.css(t).remove }
  body.xpath(".//comment()").remove
  body.traverse do |node|
    next unless node.element?
    keep = node.attributes.keys & %w[class id]
    node.attributes.each_key { |k| node.remove_attribute(k) unless keep.include?(k) }
  end
  body
end

def clean_html(raw_html)
  body = prepare_body(raw_html)

  # Truncate text nodes to 20 words — enough to signal "this is article prose"
  # vs "this is a widget" without sending the full content.
  body.xpath(".//text()").each do |t|
    words = t.content.split
    t.content = words.first(20).join(" ") + ((words.size > 20) ? "…" : "")
  end

  # Remove elements left empty after cleaning (no class, no id, no children).
  body.xpath(".//*[not(@class) and not(@id) and not(node())]").each(&:remove)

  body.to_html.gsub(/\n{3,}/, "\n\n").strip.slice(0, HTML_MAX_CHARS)
end

def build_skeleton(raw_html)
  body = prepare_body(raw_html)

  # Remove text nodes entirely — the LLM only needs class/id structure.
  body.xpath(".//text()").each(&:remove)

  # Unwrap elements with neither class nor id: they can't be CSS-targeted
  # and only add nesting depth. Work bottom-up so children are processed first.
  body.xpath(".//*[not(@class) and not(@id)]").reverse_each do |node|
    node.replace(node.children)
  end

  body.to_html.gsub(/\s+/, " ").strip.slice(0, HTML_MAX_CHARS)
end

# ── LLM calls ──────────────────────────────────────────────────────────────────

PROMPTS = {
  "local_html" => ->(html) {
    "You are an expert web scraper. Given the following HTML (possibly truncated), return " \
    "the CSS selector that captures the full main body text — not the headline, byline, sidebar, or comments.\n\nHTML:\n#{html}"
  },
  "skeleton_html" => ->(html) {
    "You are an expert web scraper. Below is an HTML skeleton (text removed, only class/id structure remains). " \
    "Return the CSS selector that targets the main article body.\n\nHTML skeleton:\n#{html}"
  }
}.freeze

def ask_llm(approach, raw_html)
  html = case approach
  when "local_html" then clean_html(raw_html)
  when "skeleton_html" then build_skeleton(raw_html)
  end

  t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  chat = RubyLLM.chat(model: MODEL)
  response = chat.with_schema(ContentSelectorSchema).ask(PROMPTS[approach].call(html))
  elapsed = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000).round(0)

  input_tokens = response.tokens.input.to_i
  output_tokens = response.tokens.output.to_i
  pricing = MODEL_PRICING[MODEL]
  cost = pricing ? ((input_tokens * pricing[:input]) + (output_tokens * pricing[:output])) / 1_000_000.0 : nil

  {selector: response.content["selector"], elapsed_ms: elapsed, input_tokens: input_tokens,
   output_tokens: output_tokens, cost: cost, error: nil}
rescue => e
  {selector: nil, elapsed_ms: nil, input_tokens: nil, output_tokens: nil, cost: nil,
   error: e.message}
end

def verify(selector, raw_html)
  doc = Nokogiri::HTML(raw_html)
  node = doc.at_css(selector)

  if node.nil?
    loose = selector.sub(/\A[a-z][a-z0-9]*/, "")
    node = doc.at_css(loose) if loose.start_with?(".", "#") && loose != selector
  end

  return "no match" if node.nil?

  wc = node.text.split.size
  (wc < 30) ? "only #{wc} words" : "ok (#{wc} words)"
rescue Nokogiri::CSS::SyntaxError
  "unverifiable (non-standard CSS classes)"
end

# ── Run ────────────────────────────────────────────────────────────────────────

all_results = []

TEST_FEEDS.each do |feed_url|
  puts "\n▶ #{feed_url}"

  article_url = nil
  print "  resolving feed... "
  begin
    article_url = first_article_url(feed_url)
    puts article_url
  rescue => e
    puts "FAILED: #{e.message}"
    next
  end

  raw_html = nil
  print "  fetching article... "
  begin
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    raw_html = fetch_html(article_url)
    puts "#{raw_html.bytesize / 1024}KB in #{((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000).round(0)}ms"
  rescue => e
    puts "FAILED: #{e.message}"
  end

  APPROACHES.each do |approach|
    next if raw_html.nil?

    r = ask_llm(approach, raw_html)
    r[:verification] = r[:selector] ? verify(r[:selector], raw_html) : "no selector"

    if r[:error]
      puts "  [#{approach}] ERROR: #{r[:error]}"
    else
      tokens = r[:input_tokens].to_i + r[:output_tokens].to_i
      puts "  [#{approach}] #{r[:elapsed_ms]}ms | #{tokens} tokens | $#{"%.5f" % r[:cost].to_f}"
      puts "    selector : #{r[:selector]}"
      puts "    verified : #{r[:verification]}"
    end

    all_results << r.merge(feed: feed_url, url: article_url, approach: approach)
  end
end

# ── Summary ────────────────────────────────────────────────────────────────────

puts "\n#{"=" * 60}"
APPROACHES.each do |approach|
  rows = all_results.select { |r| r[:approach] == approach && !r[:error] }
  next if rows.empty?

  avg_ms = rows.sum { |r| r[:elapsed_ms] } / rows.size
  avg_tokens = rows.sum { |r| r[:input_tokens].to_i + r[:output_tokens].to_i } / rows.size
  avg_cost = rows.sum { |r| r[:cost].to_f } / rows.size
  ok_count = rows.count { |r| r[:verification]&.start_with?("ok") }

  puts "  #{approach.ljust(14)}  #{avg_ms.round(0)}ms  #{avg_tokens} tokens  $#{"%.5f" % avg_cost}  valid #{ok_count}/#{rows.size}"
end

# ── Save ───────────────────────────────────────────────────────────────────────

out = File.join(__dir__, "..", "tmp", "selector_benchmark_#{Time.now.strftime("%Y%m%d_%H%M%S")}.json")
File.write(out, JSON.pretty_generate(all_results))
puts "\nSaved → #{out}"
