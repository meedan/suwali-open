module Api
  class NotesController < AuthenticatedController
    def index
      notebook = Notebook.find(params[:notebook_id])
      return unless require_member!(notebook.hub)

      notes = Note.where(notebook_id: params[:notebook_id].to_i).order(title: :asc)
      render json: notes.as_json
    end

    def create
      notebook = Notebook.find(params[:note][:notebook_id])
      return unless require_member!(notebook.hub)

      @note = Note.new(create_params)
      @note.user = current_user

      if @note.save
        render json: @note.as_json(include_notebook_item: true), status: :created
      else
        render json: {errors: @note.errors.full_messages}, status: :unprocessable_content
      end
    end

    def update
      @note = Note.find(params[:id])
      return unless require_member!(@note.notebook.hub)

      if @note.update(update_params)
        render json: @note.as_json(include_notebook_item: true), status: :ok
      else
        render json: {errors: @note.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy
      @note = Note.find(params[:id])
      return unless require_member!(@note.notebook.hub)

      @note.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    private

    def create_params
      params.require(:note).permit(:notebook_id, :title, :content)
    end

    def update_params
      params.require(:note).permit(:title, :content)
    end
  end
end
