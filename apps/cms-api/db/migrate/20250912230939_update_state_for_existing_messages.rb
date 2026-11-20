class UpdateStateForExistingMessages < ActiveRecord::Migration[7.1]
  def change
    Message.find_each do |message|
      if message.state.nil?
        message.send(:set_state)
        message.save
      end
    end
  end
end
