require "sidekiq/web"

Rails.application.routes.draw do
  # Defines the root path route ("/")
  # root "controller#index"

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", :as => :rails_health_check

  # The custom health endpoint also checks for database connectivity
  get "/health", to: "health#show"

  # Public SMS opt-in page, linked from SMS campaign registrations as the consent evidence
  get "/sms-opt-in/:hub_id/:id", to: "sms_opt_in_pages#show", as: :sms_opt_in_page

  # Swagger / Sidekiq UI — disabled in production
  if Rails.env.development?
    mount Rswag::Ui::Engine => "/api-docs"
    mount Rswag::Api::Engine => "/api-docs"
    mount Sidekiq::Web => "/sidekiq"
  end

  # Authentication
  devise_for :users,
    defaults: {format: :json},
    path: "api",
    path_names: {
      sign_in: "login",
      sign_out: "logout",
      registration: "signup"
    },
    skip: [:passwords],
    controllers: {
      sessions: "api/sessions",
      registrations: "api/registrations",
      confirmations: "api/confirmations",
      unlocks: "api/unlocks"
    }

  devise_scope :user do
    post "api/password", to: "api/passwords#create", defaults: {format: :json}
    match "api/password", to: "api/passwords#update", via: [:put, :patch], defaults: {format: :json}
  end

  namespace :api do
    # Messaging integrations
    # Telegram
    post "/webhooks/telegram/:messaging_integration_id", to: "webhooks#telegram"
    # WhatsApp: Single global WhatsApp webhook (GET = verify, POST = events)
    match "/webhooks/whatsapp", to: "webhooks#whatsapp", via: [:get, :post]
    # SMS: single per-integration webhook for inbound messages and delivery-status callbacks
    post "/webhooks/sms/:messaging_integration_id", to: "webhooks#sms"
    # WhatsApp: Embedded Sign Up (ESU) per-integration
    post "/messaging-integrations/whatsapp-callback", to: "messaging_integrations#whatsapp_callback"
    # Knowledge Service callbacks
    post "/knowledge-service-callbacks/update-sync-status", to: "knowledge_service_callbacks#update_sync_status"
    post "/knowledge-service-callbacks/update-chat-status", to: "knowledge_service_callbacks#update_chat_status"
    # Resend confirmation instructions
    resources :resends, only: [:create]

    # The actual API starts here
    get "/about", to: "about#index"
    get "/admin/export/hubs", to: "admin#export_hubs"
    get "/admin/export/message-reports", to: "admin#export_message_reports"
    get "/admin/message-reports", to: "admin#message_reports"
    get "/admin/hubs", to: "admin#hubs"
    get "/admin/hubs/:id", to: "admin#hub_detail"
    patch "/admin/hubs/:id", to: "admin#update_hub"
    delete "/admin/hubs/:id", to: "admin#destroy_hub"
    get "/admin/hubs/:id/memberships", to: "admin#hub_memberships"
    get "/admin/hubs/:id/activity", to: "admin#hub_activity"
    get "/admin/hubs/:id/deleted", to: "admin#deleted_hub_detail"
    get "/admin/statistics", to: "admin#platform_statistics"
    get "/admin/health", to: "admin#health"
    get "/admin/users/unconfirmed", to: "admin#unconfirmed_users"
    get "/admin/users/no-hub", to: "admin#users_with_no_hub"
    get "/admin/users/inactive", to: "admin#inactive_users"
    get "/admin/users/pending-approval", to: "admin#users_pending_approval"
    get "/admin/users/super-admins", to: "admin#super_admins"
    delete "/admin/users/:id", to: "admin#destroy_user"
    patch "/admin/users/:id/upgrade-to-write-admin", to: "admin#upgrade_to_write_admin"
    patch "/admin/users/:id/move-to-hub", to: "admin#move_user_to_hub"
    get "/me", to: "users#me"
    patch "/me", to: "users#update"
    patch "/me/password", to: "users#update_password"
    get "/notebooks/:item_notebook_id/notebook-items", to: "notebook_items#index"

    resources :hubs, only: [:show, :update, :create] do
      collection do
        get "joinable"
      end
      resources :sources, only: [:index]
      resources :notebooks, only: [:index]
      resources :contributions, only: [:index]
      resources :conversations, only: [:index] do
        member do
          get :export
        end
        collection do
          post :bulk_export, path: "bulk-export"
          get :latest_bulk_export, path: "bulk-export/latest"
        end
      end
      resources :hub_memberships, only: [:index, :create, :update, :destroy], path: "memberships" do
        collection do
          delete :leave
        end
      end
      resources :messaging_integrations, only: [:index], path: "messaging-integrations"
      resources :external_users, only: [:index, :create, :update], path: "external-users"
      resources :external_resources, only: [:index], path: "external-resources"
      resources :topics, only: [:index]

      member do
        get "my-conversations", to: "conversations#my_conversations"
        get "statistics", to: "hubs#statistics"
        get "message-data-source-items-ranking", to: "hubs#message_data_source_items_ranking"
        get "questions-ranking", to: "hubs#questions_ranking"
        patch "refresh-invite-code", to: "hubs#refresh_invite_code"
        post "preview", to: "hubs#preview"
      end
    end
    resources :sources, only: [:show, :create, :update, :destroy] do
      resources :documents, only: [:index]
      collection do
        post "preview"
        post "configure"
        post "detect_wordpress", to: "wordpress#detect"
        post "ownership_code", to: "wordpress_ownership#code"
        post "verify_ownership", to: "wordpress_ownership#verify"
      end
    end
    resources :documents, only: [:show, :update, :destroy] do
      resources :notebook_items, only: [:index], path: "notebook-items"
      member do
        post :retry_sync, path: "retry-sync"
        post :refresh
      end
    end
    resources :notebooks, only: [:show, :create, :update, :destroy] do
      resources :notes, only: [:index]
      resources :items, controller: "notebook_items", only: [:index, :create, :destroy]
      member do
        post :retry_sync, path: "retry-sync"
        post :regenerate_ai_summary, path: "regenerate-ai-summary"
      end
    end
    resources :notes, only: [:create, :update, :destroy]
    resources :conversations, only: [:create, :update, :destroy, :show] do
      resources :notebook_items, only: [:index], path: "notebook-items"
      resources :messages, only: [:index]
    end
    resources :message_clusters, only: [], path: "message-clusters" do
      resources :notebook_items, only: [:index], path: "notebook-items"
      member do
        get :messages
      end
    end
    resources :messages, only: [:create] do
      resources :notebook_items, only: [:index], path: "notebook-items"
      resources :message_reports, only: [:create], path: "reports"

      member do
        post :callback
      end
    end
    resources :contributions, only: [:show, :update, :destroy] do
      resources :notebook_items, only: [:index], path: "notebook-items"
      member do
        post :retry_sync, path: "retry-sync"
      end
    end
    resources :messaging_integrations, only: [:create, :destroy], path: "messaging-integrations"
    resources :external_resources, only: [:create, :update, :destroy], path: "external-resources"
    resources :topic_items, only: [:create, :destroy], path: "topic-items"
  end
end
