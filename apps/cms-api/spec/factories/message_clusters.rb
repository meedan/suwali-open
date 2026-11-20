FactoryBot.define do
  factory :message_cluster do
    association :hub
    centroid_embedding { Array.new(1024, 0.1) }
    original_text { "What is climate change?" }
    question_count { 1 }
  end
end
