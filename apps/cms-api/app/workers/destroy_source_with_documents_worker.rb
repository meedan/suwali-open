class DestroySourceWithDocumentsWorker < SoftDeleteWorker
  private

  def parent_class = Source

  def children_association = :documents
end
