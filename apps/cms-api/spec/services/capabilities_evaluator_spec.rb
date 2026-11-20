require "rails_helper"

RSpec.describe CapabilitiesEvaluator do
  let(:organization) { create(:organization) }
  let(:hub) { create(:hub, organization: organization) }
  let(:user) { create(:user) }
  let(:hub_membership) { create(:hub_membership, hub: hub, user: user) }

  describe "#evaluate_all" do
    it "returns a hash of all capabilities" do
      evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
      capabilities = evaluator.evaluate_all

      expect(capabilities).to be_a(Hash)
      expect(capabilities.keys).to match_array(CapabilitiesEvaluator::ACTIONS)
    end
  end

  describe "#evaluate" do
    context "CREATE_SOURCE" do
      context "with premium hub" do
        let(:hub) { create(:hub, organization: organization, plan: :enterprise) }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: user, role: :admin) }

        it "allows source creation for admins" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("CREATE_SOURCE")

          expect(result[:allowed]).to be true
        end
      end

      context "with free hub within trial" do
        let(:hub) { create(:hub, organization: organization, plan: :free) }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: user, role: :admin) }

        it "allows source creation when under limit for admins" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("CREATE_SOURCE")

          expect(result[:allowed]).to be true
        end

        it "denies source creation when limit reached" do
          3.times { create(:source, hub: hub) }
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("CREATE_SOURCE")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("plan_restriction", "limit_reached")
        end
      end

      context "with expired trial" do
        let(:hub) do
          create(:hub,
            organization: organization,
            plan: :free,
            trial_started_at: 60.days.ago,
            trial_ends_at: 30.days.ago)
        end
        let(:hub_membership) { create(:hub_membership, hub: hub, user: user, role: :admin) }

        it "denies source creation due to expired trial" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("CREATE_SOURCE")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("trial_expired")
        end
      end
    end

    context "CREATE_DOCUMENT" do
      context "with premium hub" do
        let(:hub) { create(:hub, organization: organization, plan: :enterprise) }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: user) }

        it "allows document creation" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("CREATE_DOCUMENT")

          expect(result[:allowed]).to be true
        end
      end

      context "with free hub within trial" do
        let(:hub) { create(:hub, organization: organization, plan: :free) }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: user) }

        it "allows document creation when under limit" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("CREATE_DOCUMENT")

          expect(result[:allowed]).to be true
        end

        it "denies document creation when limit reached" do
          # Create a source and max documents to reach the limit
          allow(hub).to receive(:max_documents_for_plan).and_return(2)
          source = create(:source, hub: hub)
          2.times { create(:document, source: source) }
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("CREATE_DOCUMENT")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("plan_restriction", "limit_reached")
        end
      end

      context "with expired trial" do
        let(:hub) do
          create(:hub,
            organization: organization,
            plan: :free,
            trial_started_at: 60.days.ago,
            trial_ends_at: 30.days.ago)
        end
        let(:hub_membership) { create(:hub_membership, hub: hub, user: user) }

        it "denies document creation" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("CREATE_DOCUMENT")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("trial_expired")
        end
      end
    end

    context "MANAGE_MESSAGING_INTEGRATION" do
      context "with premium hub" do
        let(:hub) { create(:hub, organization: organization, plan: :enterprise) }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: user, role: :admin) }

        it "allows messaging integration management for admins" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("MANAGE_MESSAGING_INTEGRATION")

          expect(result[:allowed]).to be true
        end
      end

      context "with free hub" do
        let(:hub) { create(:hub, organization: organization, plan: :free) }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: user, role: :admin) }

        it "allows messaging integration management for admins" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("MANAGE_MESSAGING_INTEGRATION")

          expect(result[:allowed]).to be true
        end
      end

      context "with expired trial" do
        let(:hub) do
          create(:hub,
            organization: organization,
            plan: :free,
            trial_started_at: 60.days.ago,
            trial_ends_at: 30.days.ago)
        end
        let(:hub_membership) { create(:hub_membership, hub: hub, user: user, role: :admin) }

        it "denies messaging integration management" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("MANAGE_MESSAGING_INTEGRATION")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("trial_expired")
        end
      end
    end

    context "MANAGE_SMS" do
      let(:hub_membership) { create(:hub_membership, hub: hub, user: user, role: :admin) }

      context "when SMS is enabled for the hub" do
        let(:hub) { create(:hub, organization: organization, plan: :enterprise, custom_limits: {"sms" => true}) }

        it "allows managing SMS for admins" do
          result = CapabilitiesEvaluator.new(hub_membership: hub_membership).evaluate("MANAGE_SMS")

          expect(result[:allowed]).to be true
        end
      end

      context "when SMS is not enabled for the hub" do
        let(:hub) { create(:hub, organization: organization, plan: :enterprise) }

        it "denies managing SMS due to plan restriction" do
          result = CapabilitiesEvaluator.new(hub_membership: hub_membership).evaluate("MANAGE_SMS")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("plan_restriction")
        end
      end

      context "when SMS is enabled for a free hub with active trial" do
        let(:hub) { create(:hub, organization: organization, plan: :free, custom_limits: {"sms" => true}) }

        it "denies managing SMS, since the plan does not include SMS" do
          result = CapabilitiesEvaluator.new(hub_membership: hub_membership).evaluate("MANAGE_SMS")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("plan_restriction")
        end
      end

      context "when SMS is enabled for a subsidized hub" do
        let(:hub) { create(:hub, organization: organization, plan: :subsidized, custom_limits: {"sms" => true}) }

        it "denies managing SMS, since the plan does not include SMS" do
          result = CapabilitiesEvaluator.new(hub_membership: hub_membership).evaluate("MANAGE_SMS")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("plan_restriction")
        end
      end

      context "when SMS is enabled for a free hub with expired trial" do
        let(:hub) do
          create(:hub,
            organization: organization,
            plan: :free,
            custom_limits: {"sms" => true},
            trial_started_at: 60.days.ago,
            trial_ends_at: 30.days.ago)
        end

        it "denies managing SMS" do
          result = CapabilitiesEvaluator.new(hub_membership: hub_membership).evaluate("MANAGE_SMS")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("trial_expired")
        end
      end
    end

    context "trial-restricted actions" do
      %w[CREATE_CONTRIBUTION CREATE_MESSAGE CREATE_NOTE CREATE_NOTEBOOK_ITEM CREATE_NOTEBOOK CREATE_CONVERSATION].each do |action|
        context action do
          context "with active trial" do
            let(:hub) { create(:hub, organization: organization, plan: :free) }
            let(:hub_membership) { create(:hub_membership, hub: hub, user: user) }

            it "allows action" do
              evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
              result = evaluator.evaluate(action)

              expect(result[:allowed]).to be true
            end
          end

          context "with expired trial" do
            let(:hub) do
              create(:hub,
                organization: organization,
                plan: :free,
                trial_started_at: 60.days.ago,
                trial_ends_at: 30.days.ago)
            end
            let(:hub_membership) { create(:hub_membership, hub: hub, user: user) }

            it "denies action" do
              evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
              result = evaluator.evaluate(action)

              expect(result[:allowed]).to be false
              expect(result[:reasons]).to include("trial_expired")
            end
          end

          context "with premium hub" do
            let(:hub) { create(:hub, organization: organization, plan: :enterprise) }
            let(:hub_membership) { create(:hub_membership, hub: hub, user: user) }

            it "allows action" do
              evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
              result = evaluator.evaluate(action)

              expect(result[:allowed]).to be true
            end
          end
        end
      end
    end

    context "admin vs editor permissions" do
      let(:hub) { create(:hub, organization: organization, plan: :enterprise) }

      context "with admin role" do
        let(:admin_membership) { create(:hub_membership, hub: hub, user: user, role: :admin) }

        it "allows admin-only actions" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: admin_membership)

          %w[MANAGE_ADMINS REMOVE_EDITOR UPDATE_SOURCE REMOVE_SOURCE UPDATE_HUB CREATE_SOURCE MANAGE_MESSAGING_INTEGRATION APPROVE_MEMBERSHIP CREATE_TOPIC].each do |action|
            result = evaluator.evaluate(action)
            expect(result[:allowed]).to be(true), "Expected #{action} to be allowed for admin"
          end
        end
      end

      context "with editor role" do
        let(:editor_membership) do
          membership = create(:hub_membership, hub: hub, user: user)
          membership.update!(role: :editor)
          membership
        end

        it "denies admin-only actions with insufficient_permissions" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: editor_membership)

          %w[MANAGE_ADMINS REMOVE_EDITOR UPDATE_SOURCE REMOVE_SOURCE APPROVE_MEMBERSHIP CREATE_TOPIC].each do |action|
            result = evaluator.evaluate(action)
            expect(result[:allowed]).to be false
            expect(result[:reasons]).to include("insufficient_permissions")
          end
        end

        it "allows non-admin actions" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: editor_membership)

          %w[CREATE_DOCUMENT CREATE_CONTRIBUTION CREATE_MESSAGE CREATE_NOTE].each do |action|
            result = evaluator.evaluate(action)
            expect(result[:allowed]).to be true
          end
        end
      end
    end

    context "IS_ADMIN" do
      context "with @meedan.com email" do
        let(:admin_user) { create(:user, email: "admin@meedan.com") }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: admin_user) }

        it "allows IS_ADMIN action" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("IS_ADMIN")

          expect(result[:allowed]).to be true
        end
      end

      context "with @meedan.org email" do
        let(:admin_user) { create(:user, email: "admin@meedan.org") }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: admin_user) }

        it "allows IS_ADMIN action" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("IS_ADMIN")

          expect(result[:allowed]).to be true
        end
      end

      context "with regular email" do
        let(:regular_user) { create(:user, email: "user@example.com") }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: regular_user) }

        it "denies IS_ADMIN action" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("IS_ADMIN")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("insufficient_permissions")
        end
      end
    end

    context "IS_WRITE_ADMIN" do
      context "with @meedan.com email and admin_write_access flag set" do
        let(:write_admin_user) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: write_admin_user) }

        it "allows IS_WRITE_ADMIN action" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("IS_WRITE_ADMIN")

          expect(result[:allowed]).to be true
        end
      end

      context "with @meedan.com email but no admin_write_access flag" do
        let(:read_admin_user) { create(:user, email: "admin@meedan.com", admin_write_access: false) }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: read_admin_user) }

        it "denies IS_WRITE_ADMIN action" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("IS_WRITE_ADMIN")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("insufficient_permissions")
        end
      end

      context "with non-meedan email even with admin_write_access flag" do
        let(:flagged_user) { create(:user, email: "user@example.com", admin_write_access: true) }
        let(:hub_membership) { create(:hub_membership, hub: hub, user: flagged_user) }

        it "denies IS_WRITE_ADMIN action" do
          evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
          result = evaluator.evaluate("IS_WRITE_ADMIN")

          expect(result[:allowed]).to be false
          expect(result[:reasons]).to include("insufficient_permissions")
        end
      end
    end

    context "unknown action" do
      it "returns not allowed with unknown_action reason" do
        evaluator = CapabilitiesEvaluator.new(hub_membership: hub_membership)
        result = evaluator.evaluate("UNKNOWN_ACTION")

        expect(result[:allowed]).to be false
        expect(result[:reasons]).to include("unknown_action")
      end
    end
  end
end
