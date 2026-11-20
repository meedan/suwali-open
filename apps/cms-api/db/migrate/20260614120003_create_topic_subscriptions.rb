class CreateTopicSubscriptions < ActiveRecord::Migration[7.1]
  def up
    create_table :topic_subscriptions do |t|
      t.references :topic, null: false, foreign_key: true
      t.references :external_user, null: false, foreign_key: true

      t.timestamps
    end

    add_index :topic_subscriptions, [:topic_id, :external_user_id], unique: true, name: "idx_unique_topic_subscription"

    execute "SELECT audit.add_audit_trigger('public', 'topic_subscriptions');"
  end

  def down
    drop_table :topic_subscriptions
  end
end
