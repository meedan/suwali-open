module LabelOrderable
  extend ActiveSupport::Concern

  class_methods do
    # Sorts by a person's name, in the case and wording the person is shown with, instead of by their id.
    # label_sql builds that name; rows where it is NULL, such as a notebook nobody edited, come last either way.
    # Filters must not make the query DISTINCT (use EXISTS), as Postgres then wants label_sql in the select list.
    def order_by_label(label_sql, direction)
      direction = (direction == "asc") ? :asc : :desc
      order(Arel.sql("#{label_sql} #{direction.upcase} NULLS LAST")).order(id: direction)
    end
  end
end
