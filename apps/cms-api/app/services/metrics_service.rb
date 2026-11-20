class MetricsService
  ENABLE_ENVS = %w[staging prod].freeze
  DEFAULT_NAMESPACE = "Suwali/CmsApi".freeze

  UNITS = %w[
    Seconds Microseconds Milliseconds
    Bytes Kilobytes Megabytes Gigabytes Terabytes
    Bits Kilobits Megabits Gigabits Terabits
    Percent Count
    Bytes/Second Kilobytes/Second Megabytes/Second Gigabytes/Second Terabytes/Second
    Bits/Second Kilobits/Second Megabits/Second Gigabits/Second Terabits/Second
    Count/Second None
  ].freeze

  def initialize(namespace: DEFAULT_NAMESPACE, hub_id: nil)
    @namespace = namespace
    @hub_id = hub_id
  end

  def measure(metric_name, unit: "Milliseconds")
    start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    yield
    duration_ms = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - start) * 1000
    publish_metric(metric_name, duration_ms, unit: unit) if metric_name
  end

  def publish_metric(metric_name, value, unit: "Count")
    env = ENV.fetch("DEPLOY_ENV", "local")
    return unless ENABLE_ENVS.include?(env)
    raise ArgumentError, "invalid CloudWatch unit: #{unit}" unless UNITS.include?(unit)

    begin
      dimensions = [
        {name: "Environment", value: env}
      ]
      dimensions << {name: "HubId", value: @hub_id.to_s} if @hub_id
      client.put_metric_data(
        namespace: @namespace,
        metric_data: [{
          metric_name: metric_name,
          value: value,
          unit: unit,
          timestamp: Time.now,
          storage_resolution: 60,
          dimensions: dimensions
        }]
      )
      LogService.log(:debug, "MetricsService", "Published metric #{@namespace}/#{metric_name}=#{value}")
    rescue => e
      LogService.log(:error, "MetricsService", "Failed to publish metric #{metric_name} to CloudWatch: #{e.message}")
    end
  end

  private

  def client
    Aws::CloudWatch::Client.new(
      region: ENV.fetch("S3_REGION", "eu-west-1"),
      credentials: Aws::ECSCredentials.new
    )
  end
end
