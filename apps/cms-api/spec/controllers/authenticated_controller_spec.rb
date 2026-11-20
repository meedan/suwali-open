require "rails_helper"

RSpec.describe AuthenticatedController, type: :controller do
  controller(AuthenticatedController) do
    skip_hub_authorization :skipped_action

    def enforced_action
      head :ok
    end

    def authorized_action
      require_member!(Hub.first)
      head :ok
    end

    def admin_authorized_action
      require_admin!(Hub.first)
      head :ok
    end

    def skipped_action
      head :ok
    end

    def early_error_action
      render json: {error: "not found"}, status: :not_found
    end
  end

  let(:user) { create(:user) }
  let!(:hub) { create(:hub, users: [user]) }

  before do
    allow(controller).to receive(:authenticate_user!).and_return(true)
    allow(controller).to receive(:current_user).and_return(user)
    routes.draw do
      get "authenticated/enforced_action"
      get "authenticated/authorized_action"
      get "authenticated/admin_authorized_action"
      get "authenticated/skipped_action"
      get "authenticated/early_error_action"
    end
  end

  it "raises when a successful action does not call require_member! or require_admin!" do
    expect { get :enforced_action }.to raise_error(RuntimeError, /did not verify hub authorization/)
  end

  it "does not raise when require_member! is called" do
    get :authorized_action
    expect(response).to have_http_status(:ok)
  end

  it "does not raise when require_admin! is called" do
    get :admin_authorized_action
    expect(response).to have_http_status(:ok)
  end

  it "does not raise for actions listed in skip_hub_authorization" do
    get :skipped_action
    expect(response).to have_http_status(:ok)
  end

  it "does not raise when the action renders an error response before authorization" do
    get :early_error_action
    expect(response).to have_http_status(:not_found)
  end
end
