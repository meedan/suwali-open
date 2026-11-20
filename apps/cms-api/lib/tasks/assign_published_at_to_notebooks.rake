# RAILS_ENV=production bundle exec rake assign_published_at_to_notebooks
desc "Backfills published_at on notebooks by copying the updated_at value"
task assign_published_at_to_notebooks: :environment do
  Notebook.where(published_at: nil, published: true).find_each { |notebook| notebook.update_column(:published_at, notebook.updated_at) if notebook.published? }
end
