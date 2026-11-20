class AddDocumentsCountToSource < ActiveRecord::Migration[7.1]
  def change
    add_column :sources, :documents_count, :integer, default: 0, null: false

    reversible do |dir|
      dir.up do
        Source.find_each do |source|
          Source.reset_counters(source.id, :documents)
        end
      end
    end
  end
end
