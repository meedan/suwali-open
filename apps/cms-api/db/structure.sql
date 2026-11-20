\restrict sy8OzXvchCQqc88dzATrLu4sSLGHZuft8KgiLfXYtRRaahYfX5fYygganDM2Y66

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg12+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA audit;


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: add_audit_trigger(text, text); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.add_audit_trigger(target_schema text, target_table text) RETURNS void
    LANGUAGE plpgsql
    AS $$
      BEGIN
        -- create the log table to put changed data in
        PERFORM audit.create_log_table(target_schema, target_table);

        -- create the trigger that will capture the data on the original table
        EXECUTE format('
          DROP TRIGGER IF EXISTS audit_trigger ON %I.%I;
          CREATE TRIGGER audit_trigger
            AFTER INSERT OR UPDATE OR DELETE ON %I.%I
            FOR EACH ROW
            EXECUTE FUNCTION audit.on_change_trigger_func();
        ', target_schema, target_table, target_schema, target_table);
      END;
      $$;


--
-- Name: create_log_table(text, text); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.create_log_table(orig_schema text, orig_table_name text) RETURNS void
    LANGUAGE plpgsql
    AS $$
      BEGIN
        EXECUTE format('
          CREATE TABLE IF NOT EXISTS audit.%I (
            log_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            log_timestamp timestamptz NOT NULL DEFAULT now(),
            log_user_id bigint,
            operation text NOT NULL,
            old_data jsonb,
            new_data jsonb
          );
          CREATE INDEX IF NOT EXISTS %I ON audit.%I (log_timestamp);
        ',
        orig_table_name || '_log',
        orig_table_name || '_log_timestamp_idx',
        orig_table_name || '_log'
        );
      END;
      $$;


--
-- Name: on_change_trigger_func(); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.on_change_trigger_func() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
  DECLARE
    log_table_name text := TG_TABLE_NAME || '_log';
    v_old_data jsonb;
    v_new_data jsonb;
    v_ignored constant text[] := ARRAY['last_login_at', 'last_active_at'];
  BEGIN
    -- capture old/new data if we changed/deleted it, otherwise just record new
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_old_data := to_jsonb(OLD);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_new_data := to_jsonb(NEW);
    END IF;

    -- Scoped to users: the columns exist nowhere else, and jsonb - text[]
    -- copies the whole row, which is not worth paying for on every write
    -- to messages or conversations. Nested so the cheap checks come first.
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'users' THEN
      -- skip only updates that changed an ignored column and nothing else.
      -- v_old_data <> v_new_data keeps an update that changed nothing at
      -- all logged exactly as before.
      IF v_old_data <> v_new_data
         AND (v_old_data - v_ignored) = (v_new_data - v_ignored) THEN
        RETURN NEW;
      END IF;
    END IF;

    -- user id needs to be set via session variable
    EXECUTE format('
      INSERT INTO audit.%I (operation, old_data, new_data, log_user_id)
      VALUES ($1, $2, $3, nullif(current_setting(''audit.current_user_id'', true), '''')::bigint)
    ', log_table_name)
    USING TG_OP, v_old_data, v_new_data;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END;
  $_$;


--
-- Name: remove_audit_trigger(text, text); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.remove_audit_trigger(target_schema text, target_table text) RETURNS void
    LANGUAGE plpgsql
    AS $$
      BEGIN
        EXECUTE format('
          DROP TRIGGER IF EXISTS audit_trigger ON %I.%I;
        ', target_schema, target_table);
        -- we keep the log table for historical records
      END;
      $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bulk_conversation_exports_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.bulk_conversation_exports_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: bulk_conversation_exports_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.bulk_conversation_exports_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.bulk_conversation_exports_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: contributions_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.contributions_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: contributions_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.contributions_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.contributions_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: conversations_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.conversations_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: conversations_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.conversations_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.conversations_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documents_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.documents_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: documents_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.documents_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.documents_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: hub_memberships_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.hub_memberships_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: hub_memberships_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.hub_memberships_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.hub_memberships_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: hubs_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.hubs_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: hubs_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.hubs_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.hubs_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: message_reports_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.message_reports_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: message_reports_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.message_reports_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.message_reports_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: messages_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.messages_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: messages_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.messages_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.messages_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: messaging_integrations_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.messaging_integrations_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: messaging_integrations_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.messaging_integrations_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.messaging_integrations_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notebooks_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.notebooks_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: notebooks_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.notebooks_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.notebooks_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notes_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.notes_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: notes_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.notes_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.notes_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sources_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.sources_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: sources_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.sources_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.sources_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: topic_items_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.topic_items_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: topic_items_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.topic_items_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.topic_items_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: topic_subscriptions_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.topic_subscriptions_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: topic_subscriptions_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.topic_subscriptions_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.topic_subscriptions_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: topics_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.topics_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: topics_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.topics_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.topics_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.users_log (
    log_id bigint NOT NULL,
    log_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    log_user_id bigint,
    operation text NOT NULL,
    old_data jsonb,
    new_data jsonb
);


--
-- Name: users_log_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

ALTER TABLE audit.users_log ALTER COLUMN log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME audit.users_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: active_storage_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_storage_attachments (
    id bigint NOT NULL,
    name character varying NOT NULL,
    record_type character varying NOT NULL,
    record_id bigint NOT NULL,
    blob_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: active_storage_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_storage_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_storage_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_storage_attachments_id_seq OWNED BY public.active_storage_attachments.id;


--
-- Name: active_storage_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_storage_blobs (
    id bigint NOT NULL,
    key character varying NOT NULL,
    filename character varying NOT NULL,
    content_type character varying,
    metadata text,
    service_name character varying NOT NULL,
    byte_size bigint NOT NULL,
    checksum character varying,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: active_storage_blobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_storage_blobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_storage_blobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_storage_blobs_id_seq OWNED BY public.active_storage_blobs.id;


--
-- Name: active_storage_variant_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_storage_variant_records (
    id bigint NOT NULL,
    blob_id bigint NOT NULL,
    variation_digest character varying NOT NULL
);


--
-- Name: active_storage_variant_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.active_storage_variant_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: active_storage_variant_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.active_storage_variant_records_id_seq OWNED BY public.active_storage_variant_records.id;


--
-- Name: ar_internal_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_internal_metadata (
    key character varying NOT NULL,
    value character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: bulk_conversation_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bulk_conversation_exports (
    id bigint NOT NULL,
    hub_id bigint NOT NULL,
    requested_by_id bigint NOT NULL,
    status integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: bulk_conversation_exports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bulk_conversation_exports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bulk_conversation_exports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bulk_conversation_exports_id_seq OWNED BY public.bulk_conversation_exports.id;


--
-- Name: contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contributions (
    id bigint NOT NULL,
    content text,
    message_id bigint NOT NULL,
    hub_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    ai_summary text,
    active boolean DEFAULT true NOT NULL,
    sync_status integer DEFAULT 0 NOT NULL,
    priority_tier integer DEFAULT 2 NOT NULL,
    last_sync_error_code character varying,
    first_time_contributor boolean DEFAULT false NOT NULL
);


--
-- Name: contributions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contributions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contributions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contributions_id_seq OWNED BY public.contributions.id;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id bigint NOT NULL,
    title character varying NOT NULL,
    platform integer NOT NULL,
    hub_id bigint NOT NULL,
    participant_type character varying NOT NULL,
    participant_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    state integer DEFAULT 0 NOT NULL,
    ai_summary text,
    messages_count integer DEFAULT 0 NOT NULL,
    deleted_at timestamp(6) without time zone,
    language character varying DEFAULT 'en'::character varying NOT NULL,
    context jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- Name: deleted_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deleted_documents (
    id bigint NOT NULL,
    external_id character varying NOT NULL,
    source_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: deleted_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deleted_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deleted_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deleted_documents_id_seq OWNED BY public.deleted_documents.id;


--
-- Name: deleted_topic_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deleted_topic_items (
    id bigint NOT NULL,
    topic_id bigint NOT NULL,
    item_type character varying NOT NULL,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: deleted_topic_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deleted_topic_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deleted_topic_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deleted_topic_items_id_seq OWNED BY public.deleted_topic_items.id;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id bigint NOT NULL,
    source_id bigint NOT NULL,
    title character varying NOT NULL,
    external_id character varying NOT NULL,
    content text,
    metadata jsonb,
    document_type integer NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    document_size integer,
    ai_summary text,
    active boolean DEFAULT true NOT NULL,
    sync_status integer DEFAULT 0 NOT NULL,
    priority_tier integer DEFAULT 1 NOT NULL,
    last_sync_error_code character varying,
    published_at timestamp(6) without time zone,
    summary text
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documents_id_seq OWNED BY public.documents.id;


--
-- Name: external_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_resources (
    id bigint NOT NULL,
    hub_id bigint NOT NULL,
    title character varying,
    description text,
    scenarios text[] DEFAULT '{}'::text[],
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    resource_type character varying
);


--
-- Name: external_resources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.external_resources_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: external_resources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.external_resources_id_seq OWNED BY public.external_resources.id;


--
-- Name: external_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_users (
    id bigint NOT NULL,
    hub_id bigint NOT NULL,
    platform integer NOT NULL,
    external_id character varying NOT NULL,
    display_name character varying,
    metadata jsonb,
    trusted_user boolean DEFAULT false,
    first_message_at timestamp without time zone,
    last_message_at timestamp without time zone,
    messages_count integer DEFAULT 0,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    opted_out_at timestamp(6) without time zone,
    first_contribution_at timestamp(6) without time zone
);


--
-- Name: external_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.external_users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: external_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.external_users_id_seq OWNED BY public.external_users.id;


--
-- Name: hub_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_memberships (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    hub_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    role integer DEFAULT 1 NOT NULL,
    approved boolean DEFAULT true NOT NULL
);


--
-- Name: hub_memberships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hub_memberships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hub_memberships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hub_memberships_id_seq OWNED BY public.hub_memberships.id;


--
-- Name: hub_reserved_invite_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hub_reserved_invite_codes (
    id bigint NOT NULL,
    code character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: hub_reserved_invite_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hub_reserved_invite_codes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hub_reserved_invite_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hub_reserved_invite_codes_id_seq OWNED BY public.hub_reserved_invite_codes.id;


--
-- Name: hubs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubs (
    id bigint NOT NULL,
    name character varying,
    invite_code character varying NOT NULL,
    organization_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    contribution_code character varying,
    allowed_features jsonb DEFAULT '{}'::jsonb NOT NULL,
    bot_attributes jsonb,
    plan integer DEFAULT 0 NOT NULL,
    trial_started_at timestamp(6) without time zone,
    trial_ends_at timestamp(6) without time zone,
    deletion_in_progress boolean DEFAULT false NOT NULL,
    deletion_started_at timestamp(6) without time zone,
    custom_limits jsonb,
    trial_emails_enabled boolean DEFAULT true NOT NULL,
    trial_emails_sent jsonb DEFAULT '[]'::jsonb NOT NULL,
    contribution_workflow_mode character varying DEFAULT 'direct'::character varying NOT NULL,
    deletion_requested_at timestamp(6) without time zone,
    deletion_requested_by_email character varying,
    contribution_audience character varying DEFAULT 'trusted_end_users'::character varying NOT NULL
);


--
-- Name: hubs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hubs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hubs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hubs_id_seq OWNED BY public.hubs.id;


--
-- Name: jwt_denylist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jwt_denylist (
    id bigint NOT NULL,
    jti character varying NOT NULL,
    exp timestamp(6) without time zone NOT NULL
);


--
-- Name: jwt_denylist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jwt_denylist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jwt_denylist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jwt_denylist_id_seq OWNED BY public.jwt_denylist.id;


--
-- Name: message_clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_clusters (
    id bigint NOT NULL,
    hub_id bigint NOT NULL,
    original_text text NOT NULL,
    question_count integer DEFAULT 1 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    centroid_message_id bigint,
    ai_summary text,
    centroid_embedding public.vector(1024)
);


--
-- Name: message_clusters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_clusters_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_clusters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_clusters_id_seq OWNED BY public.message_clusters.id;


--
-- Name: message_data_source_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_data_source_items (
    id bigint NOT NULL,
    message_id bigint NOT NULL,
    item_type character varying NOT NULL,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    item_title character varying NOT NULL
);


--
-- Name: message_data_source_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_data_source_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_data_source_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_data_source_items_id_seq OWNED BY public.message_data_source_items.id;


--
-- Name: message_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reports (
    id bigint NOT NULL,
    message_id bigint NOT NULL,
    reported_by_id bigint NOT NULL,
    comment text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: message_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_reports_id_seq OWNED BY public.message_reports.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    conversation_id bigint NOT NULL,
    body text NOT NULL,
    direction integer NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    status integer DEFAULT 0 NOT NULL,
    external_id character varying,
    payload jsonb,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    state integer,
    ai_summary text,
    message_cluster_id bigint,
    reply_to_id bigint,
    answered boolean,
    embedding public.vector(1024)
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: messaging_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messaging_integrations (
    id bigint NOT NULL,
    hub_id bigint NOT NULL,
    credentials jsonb,
    active boolean DEFAULT false,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    type character varying NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: messaging_integrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messaging_integrations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messaging_integrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messaging_integrations_id_seq OWNED BY public.messaging_integrations.id;


--
-- Name: notebook_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notebook_items (
    id bigint NOT NULL,
    notebook_id bigint NOT NULL,
    item_type character varying NOT NULL,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: notebook_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notebook_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notebook_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notebook_items_id_seq OWNED BY public.notebook_items.id;


--
-- Name: notebooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notebooks (
    id bigint NOT NULL,
    hub_id bigint NOT NULL,
    name character varying NOT NULL,
    summary text,
    published boolean DEFAULT false,
    user_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    published_at timestamp(6) without time zone,
    last_summary_updated_by_id bigint,
    ai_summary text,
    ai_summary_update_requested_at timestamp(6) without time zone,
    ai_summary_updated_at timestamp(6) without time zone,
    summary_updated_at timestamp(6) without time zone,
    active boolean DEFAULT true NOT NULL,
    sync_status integer DEFAULT 0 NOT NULL,
    priority_tier integer DEFAULT 1 NOT NULL,
    last_sync_error_code character varying
);


--
-- Name: notebooks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notebooks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notebooks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notebooks_id_seq OWNED BY public.notebooks.id;


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id bigint NOT NULL,
    notebook_id bigint NOT NULL,
    title character varying NOT NULL,
    content text NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    ai_summary text
);


--
-- Name: notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notes_id_seq OWNED BY public.notes.id;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id bigint NOT NULL,
    name character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: organizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.organizations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: organizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.organizations_id_seq OWNED BY public.organizations.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sources (
    id bigint NOT NULL,
    hub_id bigint NOT NULL,
    name character varying NOT NULL,
    source_type integer NOT NULL,
    config jsonb,
    last_synced_at timestamp(6) without time zone,
    active boolean DEFAULT false NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    deleted_at timestamp(6) without time zone,
    documents_count integer DEFAULT 0 NOT NULL,
    ingestion_started_at timestamp(6) without time zone,
    last_ingestion_errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    preloaded boolean DEFAULT false NOT NULL
);


--
-- Name: sources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sources_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sources_id_seq OWNED BY public.sources.id;


--
-- Name: topic_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topic_items (
    id bigint NOT NULL,
    topic_id bigint NOT NULL,
    item_type character varying NOT NULL,
    item_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    added_by_id bigint
);


--
-- Name: topic_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.topic_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: topic_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.topic_items_id_seq OWNED BY public.topic_items.id;


--
-- Name: topic_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topic_subscriptions (
    id bigint NOT NULL,
    topic_id bigint NOT NULL,
    external_user_id bigint NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: topic_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.topic_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: topic_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.topic_subscriptions_id_seq OWNED BY public.topic_subscriptions.id;


--
-- Name: topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topics (
    id bigint NOT NULL,
    hub_id bigint NOT NULL,
    name character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: topics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.topics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: topics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.topics_id_seq OWNED BY public.topics.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    name character varying DEFAULT ''::character varying NOT NULL,
    email character varying DEFAULT ''::character varying NOT NULL,
    encrypted_password character varying DEFAULT ''::character varying NOT NULL,
    reset_password_token character varying,
    reset_password_sent_at timestamp(6) without time zone,
    remember_created_at timestamp(6) without time zone,
    confirmation_token character varying,
    confirmed_at timestamp(6) without time zone,
    confirmation_sent_at timestamp(6) without time zone,
    unconfirmed_email character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    admin_write_access boolean DEFAULT false NOT NULL,
    password_changed_at timestamp(6) without time zone,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_at timestamp(6) without time zone,
    unlock_token character varying,
    last_login_at timestamp(6) without time zone,
    last_active_at timestamp(6) without time zone
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: active_storage_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_attachments ALTER COLUMN id SET DEFAULT nextval('public.active_storage_attachments_id_seq'::regclass);


--
-- Name: active_storage_blobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_blobs ALTER COLUMN id SET DEFAULT nextval('public.active_storage_blobs_id_seq'::regclass);


--
-- Name: active_storage_variant_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_variant_records ALTER COLUMN id SET DEFAULT nextval('public.active_storage_variant_records_id_seq'::regclass);


--
-- Name: bulk_conversation_exports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_conversation_exports ALTER COLUMN id SET DEFAULT nextval('public.bulk_conversation_exports_id_seq'::regclass);


--
-- Name: contributions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contributions ALTER COLUMN id SET DEFAULT nextval('public.contributions_id_seq'::regclass);


--
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- Name: deleted_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_documents ALTER COLUMN id SET DEFAULT nextval('public.deleted_documents_id_seq'::regclass);


--
-- Name: deleted_topic_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_topic_items ALTER COLUMN id SET DEFAULT nextval('public.deleted_topic_items_id_seq'::regclass);


--
-- Name: documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents ALTER COLUMN id SET DEFAULT nextval('public.documents_id_seq'::regclass);


--
-- Name: external_resources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_resources ALTER COLUMN id SET DEFAULT nextval('public.external_resources_id_seq'::regclass);


--
-- Name: external_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_users ALTER COLUMN id SET DEFAULT nextval('public.external_users_id_seq'::regclass);


--
-- Name: hub_memberships id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_memberships ALTER COLUMN id SET DEFAULT nextval('public.hub_memberships_id_seq'::regclass);


--
-- Name: hub_reserved_invite_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_reserved_invite_codes ALTER COLUMN id SET DEFAULT nextval('public.hub_reserved_invite_codes_id_seq'::regclass);


--
-- Name: hubs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubs ALTER COLUMN id SET DEFAULT nextval('public.hubs_id_seq'::regclass);


--
-- Name: jwt_denylist id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jwt_denylist ALTER COLUMN id SET DEFAULT nextval('public.jwt_denylist_id_seq'::regclass);


--
-- Name: message_clusters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_clusters ALTER COLUMN id SET DEFAULT nextval('public.message_clusters_id_seq'::regclass);


--
-- Name: message_data_source_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_data_source_items ALTER COLUMN id SET DEFAULT nextval('public.message_data_source_items_id_seq'::regclass);


--
-- Name: message_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reports ALTER COLUMN id SET DEFAULT nextval('public.message_reports_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: messaging_integrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messaging_integrations ALTER COLUMN id SET DEFAULT nextval('public.messaging_integrations_id_seq'::regclass);


--
-- Name: notebook_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notebook_items ALTER COLUMN id SET DEFAULT nextval('public.notebook_items_id_seq'::regclass);


--
-- Name: notebooks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notebooks ALTER COLUMN id SET DEFAULT nextval('public.notebooks_id_seq'::regclass);


--
-- Name: notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes ALTER COLUMN id SET DEFAULT nextval('public.notes_id_seq'::regclass);


--
-- Name: organizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations ALTER COLUMN id SET DEFAULT nextval('public.organizations_id_seq'::regclass);


--
-- Name: sources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources ALTER COLUMN id SET DEFAULT nextval('public.sources_id_seq'::regclass);


--
-- Name: topic_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_items ALTER COLUMN id SET DEFAULT nextval('public.topic_items_id_seq'::regclass);


--
-- Name: topic_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.topic_subscriptions_id_seq'::regclass);


--
-- Name: topics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics ALTER COLUMN id SET DEFAULT nextval('public.topics_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: bulk_conversation_exports_log bulk_conversation_exports_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.bulk_conversation_exports_log
    ADD CONSTRAINT bulk_conversation_exports_log_pkey PRIMARY KEY (log_id);


--
-- Name: contributions_log contributions_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.contributions_log
    ADD CONSTRAINT contributions_log_pkey PRIMARY KEY (log_id);


--
-- Name: conversations_log conversations_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.conversations_log
    ADD CONSTRAINT conversations_log_pkey PRIMARY KEY (log_id);


--
-- Name: documents_log documents_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.documents_log
    ADD CONSTRAINT documents_log_pkey PRIMARY KEY (log_id);


--
-- Name: hub_memberships_log hub_memberships_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.hub_memberships_log
    ADD CONSTRAINT hub_memberships_log_pkey PRIMARY KEY (log_id);


--
-- Name: hubs_log hubs_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.hubs_log
    ADD CONSTRAINT hubs_log_pkey PRIMARY KEY (log_id);


--
-- Name: message_reports_log message_reports_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.message_reports_log
    ADD CONSTRAINT message_reports_log_pkey PRIMARY KEY (log_id);


--
-- Name: messages_log messages_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.messages_log
    ADD CONSTRAINT messages_log_pkey PRIMARY KEY (log_id);


--
-- Name: messaging_integrations_log messaging_integrations_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.messaging_integrations_log
    ADD CONSTRAINT messaging_integrations_log_pkey PRIMARY KEY (log_id);


--
-- Name: notebooks_log notebooks_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.notebooks_log
    ADD CONSTRAINT notebooks_log_pkey PRIMARY KEY (log_id);


--
-- Name: notes_log notes_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.notes_log
    ADD CONSTRAINT notes_log_pkey PRIMARY KEY (log_id);


--
-- Name: sources_log sources_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.sources_log
    ADD CONSTRAINT sources_log_pkey PRIMARY KEY (log_id);


--
-- Name: topic_items_log topic_items_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.topic_items_log
    ADD CONSTRAINT topic_items_log_pkey PRIMARY KEY (log_id);


--
-- Name: topic_subscriptions_log topic_subscriptions_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.topic_subscriptions_log
    ADD CONSTRAINT topic_subscriptions_log_pkey PRIMARY KEY (log_id);


--
-- Name: topics_log topics_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.topics_log
    ADD CONSTRAINT topics_log_pkey PRIMARY KEY (log_id);


--
-- Name: users_log users_log_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.users_log
    ADD CONSTRAINT users_log_pkey PRIMARY KEY (log_id);


--
-- Name: active_storage_attachments active_storage_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_attachments
    ADD CONSTRAINT active_storage_attachments_pkey PRIMARY KEY (id);


--
-- Name: active_storage_blobs active_storage_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_blobs
    ADD CONSTRAINT active_storage_blobs_pkey PRIMARY KEY (id);


--
-- Name: active_storage_variant_records active_storage_variant_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_variant_records
    ADD CONSTRAINT active_storage_variant_records_pkey PRIMARY KEY (id);


--
-- Name: ar_internal_metadata ar_internal_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_internal_metadata
    ADD CONSTRAINT ar_internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: bulk_conversation_exports bulk_conversation_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_conversation_exports
    ADD CONSTRAINT bulk_conversation_exports_pkey PRIMARY KEY (id);


--
-- Name: contributions contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contributions
    ADD CONSTRAINT contributions_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: deleted_documents deleted_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_documents
    ADD CONSTRAINT deleted_documents_pkey PRIMARY KEY (id);


--
-- Name: deleted_topic_items deleted_topic_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_topic_items
    ADD CONSTRAINT deleted_topic_items_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: external_resources external_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_resources
    ADD CONSTRAINT external_resources_pkey PRIMARY KEY (id);


--
-- Name: external_users external_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_users
    ADD CONSTRAINT external_users_pkey PRIMARY KEY (id);


--
-- Name: hub_memberships hub_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_memberships
    ADD CONSTRAINT hub_memberships_pkey PRIMARY KEY (id);


--
-- Name: hub_reserved_invite_codes hub_reserved_invite_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_reserved_invite_codes
    ADD CONSTRAINT hub_reserved_invite_codes_pkey PRIMARY KEY (id);


--
-- Name: hubs hubs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubs
    ADD CONSTRAINT hubs_pkey PRIMARY KEY (id);


--
-- Name: jwt_denylist jwt_denylist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jwt_denylist
    ADD CONSTRAINT jwt_denylist_pkey PRIMARY KEY (id);


--
-- Name: message_clusters message_clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_clusters
    ADD CONSTRAINT message_clusters_pkey PRIMARY KEY (id);


--
-- Name: message_data_source_items message_data_source_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_data_source_items
    ADD CONSTRAINT message_data_source_items_pkey PRIMARY KEY (id);


--
-- Name: message_reports message_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reports
    ADD CONSTRAINT message_reports_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: messaging_integrations messaging_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messaging_integrations
    ADD CONSTRAINT messaging_integrations_pkey PRIMARY KEY (id);


--
-- Name: notebook_items notebook_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notebook_items
    ADD CONSTRAINT notebook_items_pkey PRIMARY KEY (id);


--
-- Name: notebooks notebooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notebooks
    ADD CONSTRAINT notebooks_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: topic_items topic_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_items
    ADD CONSTRAINT topic_items_pkey PRIMARY KEY (id);


--
-- Name: topic_subscriptions topic_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_subscriptions
    ADD CONSTRAINT topic_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: bulk_conversation_exports_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX bulk_conversation_exports_log_timestamp_idx ON audit.bulk_conversation_exports_log USING btree (log_timestamp);


--
-- Name: contributions_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX contributions_log_timestamp_idx ON audit.contributions_log USING btree (log_timestamp);


--
-- Name: conversations_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX conversations_log_timestamp_idx ON audit.conversations_log USING btree (log_timestamp);


--
-- Name: documents_log_synced_source_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX documents_log_synced_source_id_idx ON audit.documents_log USING btree (((new_data ->> 'source_id'::text))) WHERE ((new_data ->> 'sync_status'::text) = '2'::text);


--
-- Name: documents_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX documents_log_timestamp_idx ON audit.documents_log USING btree (log_timestamp);


--
-- Name: hub_memberships_log_deleted_hub_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX hub_memberships_log_deleted_hub_id_idx ON audit.hub_memberships_log USING btree (((old_data ->> 'hub_id'::text))) WHERE (operation = 'DELETE'::text);


--
-- Name: hub_memberships_log_inserted_hub_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX hub_memberships_log_inserted_hub_id_idx ON audit.hub_memberships_log USING btree (((new_data ->> 'hub_id'::text))) WHERE (operation = 'INSERT'::text);


--
-- Name: hub_memberships_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX hub_memberships_log_timestamp_idx ON audit.hub_memberships_log USING btree (log_timestamp);


--
-- Name: hubs_log_deleted_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX hubs_log_deleted_id_idx ON audit.hubs_log USING btree (((old_data ->> 'id'::text))) WHERE (operation = 'DELETE'::text);


--
-- Name: hubs_log_new_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX hubs_log_new_id_idx ON audit.hubs_log USING btree (((new_data ->> 'id'::text)));


--
-- Name: hubs_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX hubs_log_timestamp_idx ON audit.hubs_log USING btree (log_timestamp);


--
-- Name: message_reports_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX message_reports_log_timestamp_idx ON audit.message_reports_log USING btree (log_timestamp);


--
-- Name: messages_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX messages_log_timestamp_idx ON audit.messages_log USING btree (log_timestamp);


--
-- Name: messaging_integrations_log_deleted_hub_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX messaging_integrations_log_deleted_hub_id_idx ON audit.messaging_integrations_log USING btree (((old_data ->> 'hub_id'::text))) WHERE (operation = 'DELETE'::text);


--
-- Name: messaging_integrations_log_inserted_hub_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX messaging_integrations_log_inserted_hub_id_idx ON audit.messaging_integrations_log USING btree (((new_data ->> 'hub_id'::text))) WHERE (operation = 'INSERT'::text);


--
-- Name: messaging_integrations_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX messaging_integrations_log_timestamp_idx ON audit.messaging_integrations_log USING btree (log_timestamp);


--
-- Name: notebooks_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX notebooks_log_timestamp_idx ON audit.notebooks_log USING btree (log_timestamp);


--
-- Name: notes_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX notes_log_timestamp_idx ON audit.notes_log USING btree (log_timestamp);


--
-- Name: sources_log_deleted_hub_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX sources_log_deleted_hub_id_idx ON audit.sources_log USING btree (((old_data ->> 'hub_id'::text))) WHERE (operation = 'DELETE'::text);


--
-- Name: sources_log_inserted_hub_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX sources_log_inserted_hub_id_idx ON audit.sources_log USING btree (((new_data ->> 'hub_id'::text))) WHERE (operation = 'INSERT'::text);


--
-- Name: sources_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX sources_log_timestamp_idx ON audit.sources_log USING btree (log_timestamp);


--
-- Name: topic_items_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX topic_items_log_timestamp_idx ON audit.topic_items_log USING btree (log_timestamp);


--
-- Name: topic_subscriptions_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX topic_subscriptions_log_timestamp_idx ON audit.topic_subscriptions_log USING btree (log_timestamp);


--
-- Name: topics_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX topics_log_timestamp_idx ON audit.topics_log USING btree (log_timestamp);


--
-- Name: users_log_inserted_id_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX users_log_inserted_id_idx ON audit.users_log USING btree (((new_data ->> 'id'::text))) WHERE (operation = 'INSERT'::text);


--
-- Name: users_log_timestamp_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX users_log_timestamp_idx ON audit.users_log USING btree (log_timestamp);


--
-- Name: idx_on_external_id_conversation_id_direction_8927d4d0a1; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_on_external_id_conversation_id_direction_8927d4d0a1 ON public.messages USING btree (external_id, conversation_id, direction);


--
-- Name: idx_unique_deleted_topic_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_deleted_topic_item ON public.deleted_topic_items USING btree (topic_id, item_type, item_id);


--
-- Name: idx_unique_message_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_message_item ON public.message_data_source_items USING btree (message_id, item_type, item_id);


--
-- Name: idx_unique_topic_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_topic_item ON public.topic_items USING btree (topic_id, item_type, item_id);


--
-- Name: idx_unique_topic_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_topic_subscription ON public.topic_subscriptions USING btree (topic_id, external_user_id);


--
-- Name: index_active_storage_attachments_on_blob_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_active_storage_attachments_on_blob_id ON public.active_storage_attachments USING btree (blob_id);


--
-- Name: index_active_storage_attachments_uniqueness; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_active_storage_attachments_uniqueness ON public.active_storage_attachments USING btree (record_type, record_id, name, blob_id);


--
-- Name: index_active_storage_blobs_on_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_active_storage_blobs_on_key ON public.active_storage_blobs USING btree (key);


--
-- Name: index_active_storage_variant_records_uniqueness; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_active_storage_variant_records_uniqueness ON public.active_storage_variant_records USING btree (blob_id, variation_digest);


--
-- Name: index_bulk_conversation_exports_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_bulk_conversation_exports_on_hub_id ON public.bulk_conversation_exports USING btree (hub_id);


--
-- Name: index_bulk_conversation_exports_on_requested_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_bulk_conversation_exports_on_requested_by_id ON public.bulk_conversation_exports USING btree (requested_by_id);


--
-- Name: index_bulk_conversation_exports_one_pending_per_hub; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_bulk_conversation_exports_one_pending_per_hub ON public.bulk_conversation_exports USING btree (hub_id) WHERE (status = 0);


--
-- Name: index_contributions_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_contributions_on_hub_id ON public.contributions USING btree (hub_id);


--
-- Name: index_contributions_on_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_contributions_on_message_id ON public.contributions USING btree (message_id);


--
-- Name: index_contributions_on_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_contributions_on_sync_status ON public.contributions USING btree (sync_status);


--
-- Name: index_conversations_on_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_conversations_on_deleted_at ON public.conversations USING btree (deleted_at);


--
-- Name: index_conversations_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_conversations_on_hub_id ON public.conversations USING btree (hub_id);


--
-- Name: index_conversations_on_hub_id_and_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_conversations_on_hub_id_and_deleted_at ON public.conversations USING btree (hub_id, deleted_at);


--
-- Name: index_conversations_on_hub_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_conversations_on_hub_platform ON public.conversations USING btree (hub_id, platform);


--
-- Name: index_conversations_on_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_conversations_on_participant ON public.conversations USING btree (participant_type, participant_id);


--
-- Name: index_conversations_on_participant_and_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_conversations_on_participant_and_hub_id ON public.conversations USING btree (participant_type, participant_id, hub_id);


--
-- Name: index_conversations_on_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_conversations_on_state ON public.conversations USING btree (state);


--
-- Name: index_conversations_on_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_conversations_on_updated_at ON public.conversations USING btree (updated_at);


--
-- Name: index_conversations_uniqueness_per_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_conversations_uniqueness_per_participant ON public.conversations USING btree (hub_id, participant_type, participant_id, platform) WHERE ((deleted_at IS NULL) AND ((participant_type)::text = 'ExternalUser'::text));


--
-- Name: index_deleted_documents_on_external_id_and_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_deleted_documents_on_external_id_and_source_id ON public.deleted_documents USING btree (external_id, source_id);


--
-- Name: index_deleted_documents_on_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_deleted_documents_on_source_id ON public.deleted_documents USING btree (source_id);


--
-- Name: index_deleted_topic_items_on_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_deleted_topic_items_on_item ON public.deleted_topic_items USING btree (item_type, item_id);


--
-- Name: index_documents_on_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_documents_on_source_id ON public.documents USING btree (source_id);


--
-- Name: index_documents_on_source_id_and_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_documents_on_source_id_and_active ON public.documents USING btree (source_id, active);


--
-- Name: index_documents_on_source_id_and_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_documents_on_source_id_and_external_id ON public.documents USING btree (source_id, external_id);


--
-- Name: index_documents_on_source_id_and_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_documents_on_source_id_and_sync_status ON public.documents USING btree (source_id, sync_status);


--
-- Name: index_documents_on_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_documents_on_sync_status ON public.documents USING btree (sync_status);


--
-- Name: index_external_resources_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_resources_on_hub_id ON public.external_resources USING btree (hub_id);


--
-- Name: index_external_users_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_users_on_hub_id ON public.external_users USING btree (hub_id);


--
-- Name: index_external_users_on_hub_id_and_external_id_and_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_external_users_on_hub_id_and_external_id_and_platform ON public.external_users USING btree (hub_id, external_id, platform);


--
-- Name: index_external_users_on_hub_id_and_last_message_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_users_on_hub_id_and_last_message_at ON public.external_users USING btree (hub_id, last_message_at);


--
-- Name: index_external_users_on_last_message_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_users_on_last_message_at ON public.external_users USING btree (last_message_at);


--
-- Name: index_hub_memberships_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_hub_memberships_on_hub_id ON public.hub_memberships USING btree (hub_id);


--
-- Name: index_hub_memberships_on_hub_id_and_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_hub_memberships_on_hub_id_and_approved ON public.hub_memberships USING btree (hub_id, approved);


--
-- Name: index_hub_memberships_on_hub_id_role_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_hub_memberships_on_hub_id_role_approved ON public.hub_memberships USING btree (hub_id, role, approved);


--
-- Name: index_hub_memberships_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_hub_memberships_on_user_id ON public.hub_memberships USING btree (user_id);


--
-- Name: index_hub_memberships_on_user_id_and_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_hub_memberships_on_user_id_and_approved ON public.hub_memberships USING btree (user_id, approved);


--
-- Name: index_hub_memberships_on_user_id_and_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_hub_memberships_on_user_id_and_hub_id ON public.hub_memberships USING btree (user_id, hub_id);


--
-- Name: index_hub_reserved_invite_codes_on_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_hub_reserved_invite_codes_on_code ON public.hub_reserved_invite_codes USING btree (code);


--
-- Name: index_hubs_on_contribution_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_hubs_on_contribution_code ON public.hubs USING btree (contribution_code);


--
-- Name: index_hubs_on_invite_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_hubs_on_invite_code ON public.hubs USING btree (invite_code);


--
-- Name: index_hubs_on_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_hubs_on_organization_id ON public.hubs USING btree (organization_id);


--
-- Name: index_jwt_denylist_on_exp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_jwt_denylist_on_exp ON public.jwt_denylist USING btree (exp);


--
-- Name: index_jwt_denylist_on_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_jwt_denylist_on_jti ON public.jwt_denylist USING btree (jti);


--
-- Name: index_message_clusters_on_centroid_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_message_clusters_on_centroid_embedding ON public.message_clusters USING hnsw (centroid_embedding public.vector_cosine_ops);


--
-- Name: index_message_clusters_on_centroid_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_message_clusters_on_centroid_message_id ON public.message_clusters USING btree (centroid_message_id);


--
-- Name: index_message_clusters_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_message_clusters_on_hub_id ON public.message_clusters USING btree (hub_id);


--
-- Name: index_message_data_source_items_on_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_message_data_source_items_on_item ON public.message_data_source_items USING btree (item_type, item_id);


--
-- Name: index_message_data_source_items_on_item_title; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_message_data_source_items_on_item_title ON public.message_data_source_items USING btree (item_title);


--
-- Name: index_message_data_source_items_on_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_message_data_source_items_on_message_id ON public.message_data_source_items USING btree (message_id);


--
-- Name: index_message_reports_on_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_message_reports_on_message_id ON public.message_reports USING btree (message_id);


--
-- Name: index_message_reports_on_reported_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_message_reports_on_reported_by_id ON public.message_reports USING btree (reported_by_id);


--
-- Name: index_messages_on_answered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messages_on_answered ON public.messages USING btree (answered) WHERE (answered IS NOT NULL);


--
-- Name: index_messages_on_cluster_id_and_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messages_on_cluster_id_and_created_at ON public.messages USING btree (message_cluster_id, created_at);


--
-- Name: index_messages_on_conversation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messages_on_conversation_created ON public.messages USING btree (conversation_id, created_at);


--
-- Name: index_messages_on_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messages_on_conversation_id ON public.messages USING btree (conversation_id);


--
-- Name: index_messages_on_conversation_state_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messages_on_conversation_state_created ON public.messages USING btree (conversation_id, state, created_at);


--
-- Name: index_messages_on_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messages_on_embedding ON public.messages USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: index_messages_on_message_cluster_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messages_on_message_cluster_id ON public.messages USING btree (message_cluster_id);


--
-- Name: index_messages_on_reply_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_messages_on_reply_to_id ON public.messages USING btree (reply_to_id);


--
-- Name: index_messages_on_state_conversation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messages_on_state_conversation_created ON public.messages USING btree (state, conversation_id, created_at);


--
-- Name: index_messaging_integrations_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messaging_integrations_on_hub_id ON public.messaging_integrations USING btree (hub_id);


--
-- Name: index_messaging_integrations_on_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_messaging_integrations_on_type ON public.messaging_integrations USING btree (type);


--
-- Name: index_notebook_items_on_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notebook_items_on_item ON public.notebook_items USING btree (item_type, item_id);


--
-- Name: index_notebook_items_on_notebook_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notebook_items_on_notebook_id ON public.notebook_items USING btree (notebook_id);


--
-- Name: index_notebooks_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notebooks_on_hub_id ON public.notebooks USING btree (hub_id);


--
-- Name: index_notebooks_on_hub_id_and_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notebooks_on_hub_id_and_user_id ON public.notebooks USING btree (hub_id, user_id);


--
-- Name: index_notebooks_on_last_summary_updated_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notebooks_on_last_summary_updated_by_id ON public.notebooks USING btree (last_summary_updated_by_id);


--
-- Name: index_notebooks_on_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notebooks_on_sync_status ON public.notebooks USING btree (sync_status);


--
-- Name: index_notebooks_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notebooks_on_user_id ON public.notebooks USING btree (user_id);


--
-- Name: index_notes_on_notebook_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notes_on_notebook_id ON public.notes USING btree (notebook_id);


--
-- Name: index_notes_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_notes_on_user_id ON public.notes USING btree (user_id);


--
-- Name: index_sources_on_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_sources_on_deleted_at ON public.sources USING btree (deleted_at);


--
-- Name: index_sources_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_sources_on_hub_id ON public.sources USING btree (hub_id);


--
-- Name: index_sources_on_hub_id_and_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_sources_on_hub_id_and_deleted_at ON public.sources USING btree (hub_id, deleted_at);


--
-- Name: index_topic_items_on_added_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_topic_items_on_added_by_id ON public.topic_items USING btree (added_by_id);


--
-- Name: index_topic_items_on_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_topic_items_on_item ON public.topic_items USING btree (item_type, item_id);


--
-- Name: index_topic_items_on_topic_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_topic_items_on_topic_id ON public.topic_items USING btree (topic_id);


--
-- Name: index_topic_subscriptions_on_external_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_topic_subscriptions_on_external_user_id ON public.topic_subscriptions USING btree (external_user_id);


--
-- Name: index_topic_subscriptions_on_topic_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_topic_subscriptions_on_topic_id ON public.topic_subscriptions USING btree (topic_id);


--
-- Name: index_topics_on_hub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_topics_on_hub_id ON public.topics USING btree (hub_id);


--
-- Name: index_topics_on_hub_id_and_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_topics_on_hub_id_and_name ON public.topics USING btree (hub_id, name);


--
-- Name: index_users_on_confirmation_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_confirmation_token ON public.users USING btree (confirmation_token);


--
-- Name: index_users_on_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_email ON public.users USING btree (email);


--
-- Name: index_users_on_reset_password_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_reset_password_token ON public.users USING btree (reset_password_token);


--
-- Name: index_users_on_unlock_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_unlock_token ON public.users USING btree (unlock_token);


--
-- Name: bulk_conversation_exports audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.bulk_conversation_exports FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: contributions audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.contributions FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: conversations audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: documents audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: hub_memberships audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.hub_memberships FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: hubs audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.hubs FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: message_reports audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.message_reports FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: messages audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: messaging_integrations audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.messaging_integrations FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: notebooks audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.notebooks FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: notes audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: sources audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.sources FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: topic_items audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.topic_items FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: topic_subscriptions audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.topic_subscriptions FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: topics audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.topics FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: users audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION audit.on_change_trigger_func();


--
-- Name: message_clusters fk_message_clusters_hub; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_clusters
    ADD CONSTRAINT fk_message_clusters_hub FOREIGN KEY (hub_id) REFERENCES public.hubs(id) ON DELETE CASCADE;


--
-- Name: messages fk_messages_message_cluster; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_message_cluster FOREIGN KEY (message_cluster_id) REFERENCES public.message_clusters(id) ON DELETE SET NULL;


--
-- Name: hub_memberships fk_rails_14d856b298; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_memberships
    ADD CONSTRAINT fk_rails_14d856b298 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: deleted_topic_items fk_rails_18db09a5cb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_topic_items
    ADD CONSTRAINT fk_rails_18db09a5cb FOREIGN KEY (topic_id) REFERENCES public.topics(id);


--
-- Name: sources fk_rails_190884a4fd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT fk_rails_190884a4fd FOREIGN KEY (hub_id) REFERENCES public.hubs(id);


--
-- Name: bulk_conversation_exports fk_rails_1956b8304f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_conversation_exports
    ADD CONSTRAINT fk_rails_1956b8304f FOREIGN KEY (hub_id) REFERENCES public.hubs(id);


--
-- Name: messages fk_rails_27e061f508; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_rails_27e061f508 FOREIGN KEY (reply_to_id) REFERENCES public.messages(id);


--
-- Name: deleted_documents fk_rails_2e5d34505a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_documents
    ADD CONSTRAINT fk_rails_2e5d34505a FOREIGN KEY (source_id) REFERENCES public.sources(id);


--
-- Name: topic_items fk_rails_4378db5c9a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_items
    ADD CONSTRAINT fk_rails_4378db5c9a FOREIGN KEY (added_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contributions fk_rails_47ec37d495; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contributions
    ADD CONSTRAINT fk_rails_47ec37d495 FOREIGN KEY (message_id) REFERENCES public.messages(id);


--
-- Name: documents fk_rails_4ef9572f12; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT fk_rails_4ef9572f12 FOREIGN KEY (source_id) REFERENCES public.sources(id);


--
-- Name: contributions fk_rails_545474f512; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contributions
    ADD CONSTRAINT fk_rails_545474f512 FOREIGN KEY (hub_id) REFERENCES public.hubs(id);


--
-- Name: topics fk_rails_6c0b5d58ae; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT fk_rails_6c0b5d58ae FOREIGN KEY (hub_id) REFERENCES public.hubs(id);


--
-- Name: topic_subscriptions fk_rails_72d9624105; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_subscriptions
    ADD CONSTRAINT fk_rails_72d9624105 FOREIGN KEY (topic_id) REFERENCES public.topics(id);


--
-- Name: message_clusters fk_rails_7a1e468edc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_clusters
    ADD CONSTRAINT fk_rails_7a1e468edc FOREIGN KEY (centroid_message_id) REFERENCES public.messages(id);


--
-- Name: external_users fk_rails_7abfebb692; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_users
    ADD CONSTRAINT fk_rails_7abfebb692 FOREIGN KEY (hub_id) REFERENCES public.hubs(id);


--
-- Name: message_reports fk_rails_7bbda958ca; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reports
    ADD CONSTRAINT fk_rails_7bbda958ca FOREIGN KEY (reported_by_id) REFERENCES public.users(id);


--
-- Name: notes fk_rails_7f2323ad43; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT fk_rails_7f2323ad43 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: messages fk_rails_7f927086d2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_rails_7f927086d2 FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: hubs fk_rails_87a8d9c154; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubs
    ADD CONSTRAINT fk_rails_87a8d9c154 FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: active_storage_variant_records fk_rails_993965df05; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_variant_records
    ADD CONSTRAINT fk_rails_993965df05 FOREIGN KEY (blob_id) REFERENCES public.active_storage_blobs(id);


--
-- Name: messaging_integrations fk_rails_9b2752278b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messaging_integrations
    ADD CONSTRAINT fk_rails_9b2752278b FOREIGN KEY (hub_id) REFERENCES public.hubs(id);


--
-- Name: message_data_source_items fk_rails_9de99896af; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_data_source_items
    ADD CONSTRAINT fk_rails_9de99896af FOREIGN KEY (message_id) REFERENCES public.messages(id);


--
-- Name: notebooks fk_rails_aa1de3acf8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notebooks
    ADD CONSTRAINT fk_rails_aa1de3acf8 FOREIGN KEY (hub_id) REFERENCES public.hubs(id);


--
-- Name: notebooks fk_rails_ac0626a776; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notebooks
    ADD CONSTRAINT fk_rails_ac0626a776 FOREIGN KEY (last_summary_updated_by_id) REFERENCES public.users(id);


--
-- Name: notebook_items fk_rails_ad29cf5ba3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notebook_items
    ADD CONSTRAINT fk_rails_ad29cf5ba3 FOREIGN KEY (notebook_id) REFERENCES public.notebooks(id);


--
-- Name: hub_memberships fk_rails_adabf5e3cb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hub_memberships
    ADD CONSTRAINT fk_rails_adabf5e3cb FOREIGN KEY (hub_id) REFERENCES public.hubs(id);


--
-- Name: message_reports fk_rails_b2000b12a0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reports
    ADD CONSTRAINT fk_rails_b2000b12a0 FOREIGN KEY (message_id) REFERENCES public.messages(id);


--
-- Name: notes fk_rails_c35dc4ab10; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT fk_rails_c35dc4ab10 FOREIGN KEY (notebook_id) REFERENCES public.notebooks(id);


--
-- Name: active_storage_attachments fk_rails_c3b3935057; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_storage_attachments
    ADD CONSTRAINT fk_rails_c3b3935057 FOREIGN KEY (blob_id) REFERENCES public.active_storage_blobs(id);


--
-- Name: external_resources fk_rails_c452905280; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_resources
    ADD CONSTRAINT fk_rails_c452905280 FOREIGN KEY (hub_id) REFERENCES public.hubs(id);


--
-- Name: notebooks fk_rails_d5906d44d9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notebooks
    ADD CONSTRAINT fk_rails_d5906d44d9 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bulk_conversation_exports fk_rails_e76f11fea0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bulk_conversation_exports
    ADD CONSTRAINT fk_rails_e76f11fea0 FOREIGN KEY (requested_by_id) REFERENCES public.users(id);


--
-- Name: topic_items fk_rails_e9a6de7263; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_items
    ADD CONSTRAINT fk_rails_e9a6de7263 FOREIGN KEY (topic_id) REFERENCES public.topics(id);


--
-- Name: topic_subscriptions fk_rails_f5e5973a4f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_subscriptions
    ADD CONSTRAINT fk_rails_f5e5973a4f FOREIGN KEY (external_user_id) REFERENCES public.external_users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict sy8OzXvchCQqc88dzATrLu4sSLGHZuft8KgiLfXYtRRaahYfX5fYygganDM2Y66

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('20261111204311'),
('20261111172124'),
('20261022193738'),
('20261022183348'),
('20261019195819'),
('20261015141435'),
('20261014192731'),
('20261012164148'),
('20261002194703'),
('20260918025116'),
('20260918025109'),
('20260910235530'),
('20260831185734'),
('20260814153333'),
('20260814150612'),
('20260804120001'),
('20260731120001'),
('20260724120001'),
('20260703120002'),
('20260703120001'),
('20260615212952'),
('20260614120003'),
('20260614120002'),
('20260614120001'),
('20260604001919'),
('20260604000000'),
('20260601222810'),
('20260527200140'),
('20260525171501'),
('20260525000000'),
('20260520172953'),
('20260508152814'),
('20260508000000'),
('20260429233610'),
('20260421015922'),
('20260421015921'),
('20260417180601'),
('20260414152622'),
('20260414000000'),
('20260406151617'),
('20260405113745'),
('20260402010259'),
('20260329000000'),
('20260326210000'),
('20260326202217'),
('20260324120000'),
('20260320000000'),
('20260319132255'),
('20260311232421'),
('20260311232420'),
('20260305000000'),
('20260226204909'),
('20260216125908'),
('20260216124900'),
('20260213150958'),
('20260213144737'),
('20260204001053'),
('20260202120000'),
('20260130034709'),
('20260126190722'),
('20260126190636'),
('20260123010334'),
('20260123010105'),
('20260120175642'),
('20260115001543'),
('20260115001542'),
('20260114202340'),
('20260101195418'),
('20251207215534'),
('20251207215521'),
('20251124162037'),
('20251104120817'),
('20251104035107'),
('20251104035055'),
('20251104035041'),
('20251023132146'),
('20251021050430'),
('20251009233236'),
('20251007232656'),
('20250912230939'),
('20250909210712'),
('20250909205338'),
('20250901210651'),
('20250827144020'),
('20250819171447'),
('20250814162250'),
('20250814155506'),
('20250814143703'),
('20250808151906'),
('20250801201236'),
('20250801015554'),
('20250718181739'),
('20250618000648'),
('20250617231050'),
('20250614001703'),
('20250613233738'),
('20250604013907'),
('20250525152815'),
('20250523230032'),
('20250521163211'),
('20250514211857'),
('20250510193509'),
('20250510193508');

