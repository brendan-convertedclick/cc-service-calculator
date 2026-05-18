-- Phase 6: outbound client communications via the Account Manager send-as alias.

CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text NOT NULL,
  variables text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  brief_id uuid REFERENCES briefs(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  composed_by uuid NOT NULL REFERENCES team_members(id),
  template text,
  to_addresses text[] NOT NULL,
  cc_addresses text[] NOT NULL DEFAULT '{}',
  bcc_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text NOT NULL,
  drive_link text,
  approval_link text,
  gmail_thread_id text,
  gmail_message_id text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','send_failed')),
  send_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbound_emails_project_idx
  ON outbound_emails(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbound_emails_client_idx
  ON outbound_emails(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbound_emails_status_idx ON outbound_emails(status);

-- updated_at triggers
CREATE OR REPLACE FUNCTION outbound_emails_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS outbound_emails_updated_at ON outbound_emails;
CREATE TRIGGER outbound_emails_updated_at
  BEFORE UPDATE ON outbound_emails
  FOR EACH ROW EXECUTE FUNCTION outbound_emails_set_updated_at();

-- Settings additions
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS account_manager_email text NOT NULL DEFAULT 'accountmanager@convertedclick.co.za',
  ADD COLUMN IF NOT EXISTS approval_program_base_url text;

-- RLS — admin + owner only
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_templates_read ON email_templates;
CREATE POLICY email_templates_read ON email_templates
  FOR SELECT USING (current_team_member_role() IN ('admin','owner'));

DROP POLICY IF EXISTS outbound_emails_admin_all ON outbound_emails;
CREATE POLICY outbound_emails_admin_all ON outbound_emails
  FOR ALL USING (current_team_member_role() IN ('admin','owner'))
            WITH CHECK (current_team_member_role() IN ('admin','owner'));

-- Seed default templates
INSERT INTO email_templates (slug, name, subject, body_html, body_text, variables) VALUES
('completion', 'Completion notice',
 'Update on {project_name}',
 '<p>Hi {client_first_name},</p><p>The work on <strong>{project_name}</strong> is complete.</p><p>You can review everything here:<br/><a href="{drive_link}">{drive_link}</a></p><p>Let me know if anything needs adjustment.</p><p>Best,<br/>Account Manager · Converted Click</p>',
 'Hi {client_first_name},\n\nThe work on {project_name} is complete.\n\nReview everything here:\n{drive_link}\n\nLet me know if anything needs adjustment.\n\nBest,\nAccount Manager · Converted Click',
 ARRAY['client_first_name','project_name','drive_link']),
('files_review', 'Files for review',
 'Files ready for review — {project_name}',
 '<p>Hi {client_first_name},</p><p>The next round of work for <strong>{project_name}</strong> is ready for your review.</p><p>Files are here:<br/><a href="{drive_link}">{drive_link}</a></p><p>Let me know what you think.</p><p>Best,<br/>Account Manager · Converted Click</p>',
 'Hi {client_first_name},\n\nThe next round of work for {project_name} is ready for your review.\n\nFiles:\n{drive_link}\n\nLet me know what you think.\n\nBest,\nAccount Manager · Converted Click',
 ARRAY['client_first_name','project_name','drive_link']),
('approval', 'Approval request',
 'Approval needed — {project_name}',
 '<p>Hi {client_first_name},</p><p>I''d like to get your approval on the latest deliverables for <strong>{project_name}</strong>.</p><p>Files for review:<br/><a href="{drive_link}">{drive_link}</a></p><p>You can approve or leave feedback here:<br/><a href="{approval_link}">{approval_link}</a></p><p>Best,<br/>Account Manager · Converted Click</p>',
 'Hi {client_first_name},\n\nI''d like to get your approval on the latest deliverables for {project_name}.\n\nFiles for review:\n{drive_link}\n\nApprove or leave feedback:\n{approval_link}\n\nBest,\nAccount Manager · Converted Click',
 ARRAY['client_first_name','project_name','drive_link','approval_link'])
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE outbound_emails IS 'Phase 6: outbound client emails sent via accountmanager@ send-as alias.';
COMMENT ON TABLE email_templates IS 'Phase 6: reusable email templates with {placeholder} interpolation.';
