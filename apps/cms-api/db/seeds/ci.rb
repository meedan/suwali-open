puts "Seeding CI environment..."

organization = Organization.find_or_create_by!(name: "CI Organization")

hub = Hub.find_or_create_by!(
  name: "CI Hub",
  organization: organization
)

user = User.find_or_initialize_by(email: "ci@example.org")

if user.new_record?
  user.password = "xyz123@@"
  user.password_confirmation = "xyz123@@"
end

user.name = "CI User"
user.confirmed_at ||= Time.current
user.save!

HubMembership.find_or_create_by!(user: user, hub: hub) do |membership|
  membership.role = :admin
  membership.approved = true
end

source = hub.sources.first

source ||= Source.create!(
  name: "CI Knowledge Source",
  hub: hub,
  source_type: "website",
  config: {base_url: "https://meedan.org/our-work"},
  active: false
)

documents = [
  {
    external_id: "ci-doc-1",
    title: "About Meedan",
    published_at: Time.utc(2024, 1, 15, 9),
    content: "Meedan is a nonprofit organization that builds open-source software and programs that support journalism, fact-checking, and digital literacy. The organization works with journalists, researchers, and civil society groups to strengthen information ecosystems and help communities respond to misinformation."
  },
  {
    external_id: "ci-doc-2",
    title: "Meedan Tools",
    published_at: Time.utc(2024, 6, 1, 12),
    content: "Meedan develops tools that help newsrooms and organizations collaborate on verification and audience engagement. One of its best-known tools is Check, an open-source platform used by fact-checkers to track and verify claims circulating online."
  },
  {
    external_id: "ci-doc-3",
    title: "Suwali",
    content: "Suwali is an AI-powered tool developed by Meedan to help media and civil society organizations answer questions from their communities using trusted information sources and curated knowledge collections."
  }
]

documents.each do |doc|
  document = Document.find_or_create_by!(
    external_id: doc[:external_id],
    source: source
  ) do |d|
    d.title = doc[:title]
    d.content = doc[:content]
    d.document_type = "txt"
    d.published_at = doc[:published_at]
  end

  text = doc[:content]

  unless document.file.attached?
    document.file.attach(
      io: StringIO.new(text),
      filename: "document-#{document.id}.txt",
      key: "documents/#{document.id}.txt",
      content_type: "text/plain"
    )
  end
end

puts "CI seed created"
puts "Hub: #{hub.name}"
puts "User: #{user.email}"
puts "Source: #{source.name}"
puts "Documents: #{Document.where(source: source).count}"
