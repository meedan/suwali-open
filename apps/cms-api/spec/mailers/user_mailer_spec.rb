require "rails_helper"

RSpec.describe UserMailer, type: :mailer do
  describe "confirmation_instructions" do
    let(:user) { create(:user, confirmed_at: nil) }
    let(:token) { "test_confirmation_token_123" }

    before do
      ActionMailer::Base.deliveries.clear
    end

    it "sends confirmation email with frontend URL" do
      mail = UserMailer.confirmation_instructions(user, token, {})

      expect(mail.to).to eq([user.email])
      expect(mail.subject).to match(/confirmation/i)
      expect(mail.body.encoded).to include("/confirm?confirmation_token=#{token}&amp;email=#{CGI.escape(user.email)}")
      expect(mail.body.encoded).to include(ENV.fetch("FRONTEND_URL", "http://localhost:5173"))
      expect(mail.body.encoded).not_to include("/api/confirmation")
    end

    it "sets the confirmation_url instance variable" do
      mail = UserMailer.confirmation_instructions(user, token, {})

      # The @confirmation_url should be set and used in the email body
      expect(mail.body.encoded).to include("#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/confirm?confirmation_token=#{token}&amp;email=#{CGI.escape(user.email)}")
    end
  end

  describe "unlock_instructions" do
    let(:user) { create(:user) }
    let(:token) { "test_unlock_token_123" }

    before do
      ActionMailer::Base.deliveries.clear
    end

    it "sends unlock email to the user" do
      mail = UserMailer.unlock_instructions(user, token, {})

      expect(mail.to).to eq([user.email])
      expect(mail.subject).to match(/unlock/i)
    end

    it "includes the user email in the greeting" do
      mail = UserMailer.unlock_instructions(user, token, {})

      expect(mail.body.encoded).to include(user.email)
    end

    it "includes an unlock link pointing to the backend API" do
      mail = UserMailer.unlock_instructions(user, token, {})

      expect(mail.body.encoded).to include("/api/unlock")
      expect(mail.body.encoded).to include(token)
    end
  end

  describe "reset_password_instructions" do
    let(:user) { create(:user) }
    let(:token) { "test_reset_token_123" }

    before do
      ActionMailer::Base.deliveries.clear
    end

    it "sends reset password email to the user" do
      mail = UserMailer.reset_password_instructions(user, token, {})

      expect(mail.to).to eq([user.email])
      expect(mail.subject).to eq(I18n.t("devise.mailer.reset_password_instructions.subject"))
    end

    it "links straight to the frontend change password page" do
      mail = UserMailer.reset_password_instructions(user, token, {})

      expect(mail.body.encoded).to include("#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/change-password?token=#{token}")
      expect(mail.body.encoded).not_to include("/api/password")
    end

    it "escapes the token so it cannot inject extra query parameters" do
      mail = UserMailer.reset_password_instructions(user, "abc&next=https://evil.example.com", {})

      href = Nokogiri::HTML(mail.body.to_s).at_css("a[href*='change-password']")["href"]
      query = URI.decode_www_form(URI.parse(href).query)
      expect(query.map(&:first)).to eq(["token"])
    end

    it "includes the user email in the greeting" do
      mail = UserMailer.reset_password_instructions(user, token, {})

      expect(mail.body.encoded).to include(user.email)
    end
  end

  describe "account_exists" do
    let(:user) { create(:user) }

    it "sends an account exists notification email" do
      mail = UserMailer.account_exists(user)

      expect(mail.to).to eq([user.email])
      expect(mail.subject).to eq(I18n.t(:mailer_user_account_exists_subject))
      expect(mail.body.encoded).to include(ENV.fetch("FRONTEND_URL", "http://localhost:5173"))
      expect(mail.body.encoded).to include("forgot-password")
    end
  end
end
