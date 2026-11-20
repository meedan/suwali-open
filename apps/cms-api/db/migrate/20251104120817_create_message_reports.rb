class CreateMessageReports < ActiveRecord::Migration[7.1]
  def change
    create_table :message_reports do |t|
      t.references :message, null: false, foreign_key: true
      t.references :reported_by, null: false, foreign_key: {to_table: :users}
      t.text :comment, null: true

      t.timestamps
    end
  end
end
