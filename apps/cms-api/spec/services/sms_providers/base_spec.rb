require "rails_helper"

RSpec.describe SmsProviders::Base do
  subject(:port) { described_class.new }

  it "requires subclasses to implement every port method" do
    expect { port.deliver(to: "x", body: "y") }.to raise_error(NotImplementedError)
    expect { port.send_typing_indicator(to: "x") }.to raise_error(NotImplementedError)
    expect { port.parse_inbound(nil) }.to raise_error(NotImplementedError)
    expect { port.verify_signature(nil) }.to raise_error(NotImplementedError)
    expect { port.handle_status_callback({}) }.to raise_error(NotImplementedError)
    expect { port.provision_number(country: "US") }.to raise_error(NotImplementedError)
    expect { port.configure_inbound_webhook(phone_number: "x", url: "y") }.to raise_error(NotImplementedError)
    expect { port.registration_status({}) }.to raise_error(NotImplementedError)
  end
end
