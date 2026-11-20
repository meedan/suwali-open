require_relative "../unit_spec_helper"
require_relative "../../app/services/phone_identity"

RSpec.describe PhoneIdentity do
  describe ".variants" do
    {
      "5511991234567" => ["5511991234567", "551191234567"],
      "551191234567" => ["551191234567", "5511991234567"],
      "5215512345678" => ["5215512345678", "525512345678"],
      "525512345678" => ["525512345678", "5215512345678"]
    }.each do |external_id, expected|
      it "matches both forms of #{external_id}" do
        expect(described_class.variants(external_id, "whatsapp")).to eq(expected)
      end
    end

    it "leaves a Brazilian landline alone, since it never had a ninth digit to gain" do
      expect(described_class.variants("551132654321", "whatsapp")).to eq(["551132654321"])
    end

    # Both of these are assignable Brazilian numbers in their own right, so pairing them with the
    # other length would merge two different people.
    it "leaves the Brazilian eight-digit mobile range alone" do
      expect(described_class.variants("551171234567", "whatsapp")).to eq(["551171234567"])
      expect(described_class.variants("5511971234567", "whatsapp")).to eq(["5511971234567"])
    end

    it "leaves a Brazilian mobile whose shortened form would be a landline alone" do
      expect(described_class.variants("5511951234567", "whatsapp")).to eq(["5511951234567"])
    end

    it "leaves a Mexican number that is the wrong length alone" do
      expect(described_class.variants("52551234567", "whatsapp")).to eq(["52551234567"])
      expect(described_class.variants("52155123456789", "whatsapp")).to eq(["52155123456789"])
    end

    # The two forms can belong to two different people; see the note in PhoneIdentity.
    it "leaves Argentine numbers alone" do
      expect(described_class.variants("541145551234", "whatsapp")).to eq(["541145551234"])
      expect(described_class.variants("5491145551234", "whatsapp")).to eq(["5491145551234"])
    end

    it "leaves numbers from countries without a registry quirk alone" do
      expect(described_class.variants("15551234567", "whatsapp")).to eq(["15551234567"])
    end

    it "leaves WhatsApp Business-scoped user ids alone" do
      expect(described_class.variants("US.1349120865530274", "whatsapp")).to eq(["US.1349120865530274"])
    end

    it "does not apply to platforms whose identifiers are already canonical" do
      expect(described_class.variants("5511991234567", "sms")).to eq(["5511991234567"])
      expect(described_class.variants("5511991234567", "telegram")).to eq(["5511991234567"])
    end
  end
end
