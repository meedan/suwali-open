require "rails_helper"

RSpec.describe LabelOrderable do
  let(:hub) { create(:hub) }

  {Notebook => :name, Conversation => :title, Contribution => :content}.each do |model, label_column|
    describe "#{model}.order_by_label" do
      let(:label_sql) { "NULLIF(#{model.table_name}.#{label_column}, 'unlabelled')" }
      let(:records) { model.where(hub: hub) }
      let(:factory) { model.model_name.singular.to_sym }
      let(:column) { label_column }

      def make(label)
        create(factory, hub: hub, **{column => label})
      end

      def labels(direction)
        records.order_by_label(label_sql, direction).map { |record| record.public_send(column) }
      end

      it "orders by the label, with unlabelled rows last in both directions" do
        %w[beta unlabelled alpha].each { |label| make(label) }

        expect(labels("asc")).to eq(%w[alpha beta unlabelled])
        expect(labels("desc")).to eq(%w[beta alpha unlabelled])
      end

      it "breaks ties by id in the same direction" do
        first, second = %w[one two].map { |label| make(label) }

        expect(records.order_by_label("LOWER('same')", "asc")).to eq([first, second])
        expect(records.order_by_label("LOWER('same')", "desc")).to eq([second, first])
      end

      it "sorts descending when the direction is anything but asc" do
        %w[alpha beta].each { |label| make(label) }

        expect(labels("sideways; DROP TABLE #{model.table_name}")).to eq(%w[beta alpha])
      end
    end
  end
end
