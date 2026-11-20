# pg_dump 17+ emits `SET transaction_timeout = 0;` which PostgreSQL < 17 does not recognize. Strip it from structure.sql automatically after every schema dump.
Rake::Task["db:schema:dump"].enhance do
  structure_file = Rails.root.join("db/structure.sql")
  next unless structure_file.exist?

  original = structure_file.read
  cleaned = original.gsub(/^SET transaction_timeout = \d+;\n/, "")
  structure_file.write(cleaned) if cleaned != original

  server_version = original[/^-- Dumped from database version (\d+\.\d+)/, 1]
  client_version = original[/^-- Dumped by pg_dump version (\d+\.\d+)/, 1]
  if server_version != client_version
    warn "pg_dump #{client_version} does not match Postgres #{server_version}. Stop the stack, run `make up-rebuild-cms-api` on the host and dump the schema again."
  end
end
