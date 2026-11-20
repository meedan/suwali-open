FactoryBot.define do
  factory :source do
    hub { build(:hub) }
    name { "Annual Reports" }
    source_type { 1 }
    config { {google_drive_folder_id: "XYZ123"} }
    active { true }
    last_synced_at { Time.now }

    trait :wordpress_api do
      source_type { :wordpress_api }
      config { {"site_url" => "https://blog.example.com"} }

      before(:create) do |source|
        source.hub.save! if source.hub.new_record?
        source.hub_id = source.hub.id
        site_url = source.config.to_h["site_url"]
        source.ownership_receipt ||= SourceIngestors::WordpressOwnership.receipt(
          hub_id: source.hub.id, site_url: site_url, api_base: "#{site_url}/wp-json/wp/v2"
        )
      end
    end
  end
end
