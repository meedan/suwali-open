require "rails_helper"

RSpec.describe MetricsService, type: :service do
  let(:cloudwatch_client) { instance_double(Aws::CloudWatch::Client) }
  let(:ecs_credentials) { instance_double(Aws::ECSCredentials) }

  before do
    allow(Aws::ECSCredentials).to receive(:new).and_return(ecs_credentials)
    allow(Aws::CloudWatch::Client).to receive(:new).and_return(cloudwatch_client)
    allow(cloudwatch_client).to receive(:put_metric_data)
  end

  around do |example|
    original_deploy_env = ENV["DEPLOY_ENV"]
    original_s3_region = ENV["S3_REGION"]
    example.run
  ensure
    ENV["DEPLOY_ENV"] = original_deploy_env
    ENV["S3_REGION"] = original_s3_region
  end

  describe "#measure" do
    let(:service) { described_class.new }

    before do
      allow(service).to receive(:measure).and_call_original
      allow(service).to receive(:publish_metric)
    end

    it "yields the block" do
      expect { |b| service.measure("my.metric", &b) }.to yield_control
    end

    it "publishes duration in Milliseconds after the block completes" do
      service.measure("my.metric") { nil }
      expect(service).to have_received(:publish_metric)
        .with("my.metric", kind_of(Numeric), unit: "Milliseconds")
    end
  end

  describe "#publish_metric" do
    before do
      allow_any_instance_of(MetricsService).to receive(:publish_metric).and_call_original
    end

    context "when DEPLOY_ENV is not staging or prod" do
      it "returns early without creating a CloudWatch client in local" do
        ENV["DEPLOY_ENV"] = "local"
        expect(Aws::CloudWatch::Client).not_to receive(:new)
        described_class.new.publish_metric("test.metric", 42)
      end

      it "returns early when DEPLOY_ENV is unset" do
        ENV.delete("DEPLOY_ENV")
        expect(Aws::CloudWatch::Client).not_to receive(:new)
        described_class.new.publish_metric("test.metric", 42)
      end

      it "returns early in development" do
        ENV["DEPLOY_ENV"] = "development"
        expect(Aws::CloudWatch::Client).not_to receive(:new)
        described_class.new.publish_metric("test.metric", 42)
      end
    end

    context "when DEPLOY_ENV is staging" do
      before { ENV["DEPLOY_ENV"] = "staging" }

      it "publishes to CloudWatch with default namespace and unit" do
        expect(Aws::CloudWatch::Client).to receive(:new).with(region: "eu-west-1", credentials: ecs_credentials).and_return(cloudwatch_client)
        expect(cloudwatch_client).to receive(:put_metric_data) do |args|
          expect(args[:namespace]).to eq("Suwali/CmsApi")
          expect(args[:metric_data].size).to eq(1)
          datum = args[:metric_data].first
          expect(datum[:metric_name]).to eq("test.metric")
          expect(datum[:value]).to eq(42)
          expect(datum[:unit]).to eq("Count")
          expect(datum[:storage_resolution]).to eq(60)
          expect(datum[:dimensions]).to eq([{name: "Environment", value: "staging"}])
          expect(datum[:timestamp]).to be_a(Time)
        end

        described_class.new.publish_metric("test.metric", 42)
      end

      it "accepts custom unit" do
        expect(cloudwatch_client).to receive(:put_metric_data) do |args|
          expect(args[:metric_data].first[:unit]).to eq("Milliseconds")
          expect(args[:metric_data].first[:value]).to eq(123.45)
        end

        described_class.new.publish_metric("custom.metric", 123.45, unit: "Milliseconds")
      end

      it "accepts custom namespace via constructor" do
        expect(cloudwatch_client).to receive(:put_metric_data) do |args|
          expect(args[:namespace]).to eq("Custom/NS")
        end

        described_class.new(namespace: "Custom/NS").publish_metric("custom.metric", 123.45)
      end

      it "uses S3_REGION when set" do
        ENV["S3_REGION"] = "us-east-1"
        expect(Aws::CloudWatch::Client).to receive(:new).with(region: "us-east-1", credentials: ecs_credentials).and_return(cloudwatch_client)
        described_class.new.publish_metric("test.metric", 1)
      end

      it "defaults to eu-west-1 when S3_REGION is unset" do
        ENV.delete("S3_REGION")
        expect(Aws::CloudWatch::Client).to receive(:new).with(region: "eu-west-1", credentials: ecs_credentials).and_return(cloudwatch_client)
        described_class.new.publish_metric("test.metric", 1)
      end

      it "raises ArgumentError for invalid unit" do
        expect {
          described_class.new.publish_metric("test.metric", 1, unit: "Nonsense")
        }.to raise_error(ArgumentError, /invalid CloudWatch unit/)
      end

      it "swallows CloudWatch errors and logs via LogService" do
        allow(cloudwatch_client).to receive(:put_metric_data).and_raise(StandardError.new("boom"))
        expect(LogService).to receive(:log).with(:error, "MetricsService", /Failed to publish metric test.metric.*boom/)

        expect {
          described_class.new.publish_metric("test.metric", 1)
        }.not_to raise_error
      end

      it "logs a debug line on success" do
        expect(LogService).to receive(:log).with(:debug, "MetricsService", "Published metric Suwali/CmsApi/test.metric=1")
        described_class.new.publish_metric("test.metric", 1)
      end

      it "includes HubId dimension when hub_id is provided" do
        expect(cloudwatch_client).to receive(:put_metric_data) do |args|
          expect(args[:metric_data].first[:dimensions]).to include({name: "HubId", value: "99"})
        end
        described_class.new(hub_id: 99).publish_metric("test.metric", 1)
      end

      it "only includes Environment dimension when hub_id is nil" do
        expect(cloudwatch_client).to receive(:put_metric_data) do |args|
          expect(args[:metric_data].first[:dimensions]).to eq([{name: "Environment", value: "staging"}])
        end
        described_class.new.publish_metric("test.metric", 1)
      end
    end

    context "when DEPLOY_ENV is prod" do
      before { ENV["DEPLOY_ENV"] = "prod" }

      it "publishes to CloudWatch with prod environment dimension" do
        expect(cloudwatch_client).to receive(:put_metric_data) do |args|
          expect(args[:metric_data].first[:dimensions]).to eq([{name: "Environment", value: "prod"}])
        end

        described_class.new.publish_metric("test.metric", 1)
      end
    end
  end
end
