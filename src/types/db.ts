export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      brief_intelligence: {
        Row: {
          am_notes: string | null
          am_reviewed_at: string | null
          am_reviewed_by: string | null
          am_status: string
          audit_trail: Json
          brief_id: string
          business_objective: string | null
          client_context_snap: Json | null
          confidence_level: string | null
          created_at: string
          estimated_price_cents: number | null
          id: string
          inferred_deadline: string | null
          inferred_start_date: string | null
          open_questions: Json | null
          pipeline_version: string | null
          priority_tier: string | null
          requirements: Json | null
          services_snapshot: Json | null
          summary: string | null
          total_ai_hours: number | null
          total_human_hours_high: number | null
          total_human_hours_low: number | null
          total_human_hours_mid: number | null
          updated_at: string
          work_breakdown: Json | null
        }
        Insert: {
          am_notes?: string | null
          am_reviewed_at?: string | null
          am_reviewed_by?: string | null
          am_status?: string
          audit_trail?: Json
          brief_id: string
          business_objective?: string | null
          client_context_snap?: Json | null
          confidence_level?: string | null
          created_at?: string
          estimated_price_cents?: number | null
          id?: string
          inferred_deadline?: string | null
          inferred_start_date?: string | null
          open_questions?: Json | null
          pipeline_version?: string | null
          priority_tier?: string | null
          requirements?: Json | null
          services_snapshot?: Json | null
          summary?: string | null
          total_ai_hours?: number | null
          total_human_hours_high?: number | null
          total_human_hours_low?: number | null
          total_human_hours_mid?: number | null
          updated_at?: string
          work_breakdown?: Json | null
        }
        Update: {
          am_notes?: string | null
          am_reviewed_at?: string | null
          am_reviewed_by?: string | null
          am_status?: string
          audit_trail?: Json
          brief_id?: string
          business_objective?: string | null
          client_context_snap?: Json | null
          confidence_level?: string | null
          created_at?: string
          estimated_price_cents?: number | null
          id?: string
          inferred_deadline?: string | null
          inferred_start_date?: string | null
          open_questions?: Json | null
          pipeline_version?: string | null
          priority_tier?: string | null
          requirements?: Json | null
          services_snapshot?: Json | null
          summary?: string | null
          total_ai_hours?: number | null
          total_human_hours_high?: number | null
          total_human_hours_low?: number | null
          total_human_hours_mid?: number | null
          updated_at?: string
          work_breakdown?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "brief_intelligence_am_reviewed_by_fkey"
            columns: ["am_reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_intelligence_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: true
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_messages: {
        Row: {
          attachments: Json
          body_html: string | null
          body_text: string | null
          brief_id: string
          cc_emails: string[]
          created_at: string
          direction: string
          from_email: string | null
          from_name: string | null
          gmail_message_id: string
          id: string
          relayed_by: string | null
          sent_at: string
          subject: string | null
          to_emails: string[]
        }
        Insert: {
          attachments?: Json
          body_html?: string | null
          body_text?: string | null
          brief_id: string
          cc_emails?: string[]
          created_at?: string
          direction: string
          from_email?: string | null
          from_name?: string | null
          gmail_message_id: string
          id?: string
          relayed_by?: string | null
          sent_at: string
          subject?: string | null
          to_emails?: string[]
        }
        Update: {
          attachments?: Json
          body_html?: string | null
          body_text?: string | null
          brief_id?: string
          cc_emails?: string[]
          created_at?: string
          direction?: string
          from_email?: string | null
          from_name?: string | null
          gmail_message_id?: string
          id?: string
          relayed_by?: string | null
          sent_at?: string
          subject?: string | null
          to_emails?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "brief_messages_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      briefs: {
        Row: {
          assignee_id: string | null
          client_id: string | null
          created_at: string
          draft_reply: string | null
          gmail_thread_id: string | null
          gmail_thread_id_unique: string | null
          id: string
          intent_type: string | null
          last_message_at: string | null
          message_count: number
          parent_project_id: string | null
          raw_attachments: Json | null
          raw_body: string
          raw_subject: string | null
          received_at: string
          rejection_reason: string | null
          sender_email: string | null
          source: Database["public"]["Enums"]["brief_source"]
          status: Database["public"]["Enums"]["brief_status"]
          triaged_at: string | null
          triaged_by: string | null
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          client_id?: string | null
          created_at?: string
          draft_reply?: string | null
          gmail_thread_id?: string | null
          gmail_thread_id_unique?: string | null
          id?: string
          intent_type?: string | null
          last_message_at?: string | null
          message_count?: number
          parent_project_id?: string | null
          raw_attachments?: Json | null
          raw_body: string
          raw_subject?: string | null
          received_at?: string
          rejection_reason?: string | null
          sender_email?: string | null
          source: Database["public"]["Enums"]["brief_source"]
          status?: Database["public"]["Enums"]["brief_status"]
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          client_id?: string | null
          created_at?: string
          draft_reply?: string | null
          gmail_thread_id?: string | null
          gmail_thread_id_unique?: string | null
          id?: string
          intent_type?: string | null
          last_message_at?: string | null
          message_count?: number
          parent_project_id?: string | null
          raw_attachments?: Json | null
          raw_body?: string
          raw_subject?: string | null
          received_at?: string
          rejection_reason?: string | null
          sender_email?: string | null
          source?: Database["public"]["Enums"]["brief_source"]
          status?: Database["public"]["Enums"]["brief_status"]
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefs_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefs_parent_project_id_fkey"
            columns: ["parent_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefs_triaged_by_fkey"
            columns: ["triaged_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          clickup_folder_id: string | null
          created_at: string
          id: string
          margin_target_pct: number | null
          name: string
          notes: string | null
          primary_domain: string | null
          updated_at: string
          wiki_path: string | null
          xero_contact_id: string | null
        }
        Insert: {
          archived_at?: string | null
          clickup_folder_id?: string | null
          created_at?: string
          id?: string
          margin_target_pct?: number | null
          name: string
          notes?: string | null
          primary_domain?: string | null
          updated_at?: string
          wiki_path?: string | null
          xero_contact_id?: string | null
        }
        Update: {
          archived_at?: string | null
          clickup_folder_id?: string | null
          created_at?: string
          id?: string
          margin_target_pct?: number | null
          name?: string
          notes?: string | null
          primary_domain?: string | null
          updated_at?: string
          wiki_path?: string | null
          xero_contact_id?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          client_id: string
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_primary: boolean
          role: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          is_primary?: boolean
          role?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_primary?: boolean
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          archived_at: string | null
          color: string | null
          cost_rate_cents: number | null
          created_at: string
          display_order: number
          hourly_rate_cents: number
          id: string
          name: string
          primary_team_member_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          cost_rate_cents?: number | null
          created_at?: string
          display_order?: number
          hourly_rate_cents?: number
          id?: string
          name: string
          primary_team_member_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          cost_rate_cents?: number | null
          created_at?: string
          display_order?: number
          hourly_rate_cents?: number
          id?: string
          name?: string
          primary_team_member_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_primary_team_member_id_fkey"
            columns: ["primary_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      list_alias_overrides: {
        Row: {
          client_id: string
          created_at: string
          id: string
          list_name: string
          work_stream: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          list_name: string
          work_stream: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          list_name?: string
          work_stream?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_alias_overrides_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      list_aliases: {
        Row: {
          aliases: string[]
          id: string
          updated_at: string
          work_stream: string
        }
        Insert: {
          aliases: string[]
          id?: string
          updated_at?: string
          work_stream: string
        }
        Update: {
          aliases?: string[]
          id?: string
          updated_at?: string
          work_stream?: string
        }
        Relationships: []
      }
      master_sows: {
        Row: {
          body_md: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          body_md: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      process_steps: {
        Row: {
          ai_generated: boolean
          created_at: string
          department_id: string | null
          description: string | null
          estimated_hours: number | null
          id: string
          ordinal: number
          service_id: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_generated?: boolean
          created_at?: string
          department_id?: string | null
          description?: string | null
          estimated_hours?: number | null
          id?: string
          ordinal: number
          service_id: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_generated?: boolean
          created_at?: string
          department_id?: string | null
          description?: string | null
          estimated_hours?: number | null
          id?: string
          ordinal?: number
          service_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_steps_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_steps_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "process_steps_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      project_actuals: {
        Row: {
          actual_hours: number
          clickup_task_id: string
          dept_id: string | null
          id: string
          planned_hours: number
          project_id: string
          recorded_at: string
          status_at_sync: string | null
          synced_at: string
          time_entries: Json | null
        }
        Insert: {
          actual_hours?: number
          clickup_task_id: string
          dept_id?: string | null
          id?: string
          planned_hours: number
          project_id: string
          recorded_at?: string
          status_at_sync?: string | null
          synced_at?: string
          time_entries?: Json | null
        }
        Update: {
          actual_hours?: number
          clickup_task_id?: string
          dept_id?: string | null
          id?: string
          planned_hours?: number
          project_id?: string
          recorded_at?: string
          status_at_sync?: string | null
          synced_at?: string
          time_entries?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "project_actuals_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_actuals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          clickup_parent_task_id: string
          client_id: string | null
          completed_at: string | null
          created_at: string
          due_date: string | null
          engagement_type: string
          first_delivery_at: string | null
          git_remote_url: string | null
          id: string
          is_recurring: boolean
          last_recurring_cycle_at: string | null
          name: string
          project_code: string
          quote_id: string
          recurrence_end: string | null
          recurrence_interval:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_mode: Database["public"]["Enums"]["recurrence_mode"]
          recurrence_start: string | null
          scope_status: string
          started_at: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          xero_invoice_id: string | null
        }
        Insert: {
          clickup_parent_task_id: string
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          engagement_type?: string
          first_delivery_at?: string | null
          git_remote_url?: string | null
          id?: string
          is_recurring?: boolean
          last_recurring_cycle_at?: string | null
          name: string
          project_code: string
          quote_id: string
          recurrence_end?: string | null
          recurrence_interval?:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_mode?: Database["public"]["Enums"]["recurrence_mode"]
          recurrence_start?: string | null
          scope_status?: string
          started_at?: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          xero_invoice_id?: string | null
        }
        Update: {
          clickup_parent_task_id?: string
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          engagement_type?: string
          first_delivery_at?: string | null
          git_remote_url?: string | null
          id?: string
          is_recurring?: boolean
          last_recurring_cycle_at?: string | null
          name?: string
          project_code?: string
          quote_id?: string
          recurrence_end?: string | null
          recurrence_interval?:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_mode?: Database["public"]["Enums"]["recurrence_mode"]
          recurrence_start?: string | null
          scope_status?: string
          started_at?: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          xero_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: true
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_line_item_allocations: {
        Row: {
          cost_share_cents: number
          created_at: string
          dept_id: string
          dept_name: string
          hours: number
          id: string
          ordinal: number
          qty: number
          quote_id: string
          service_id: string
          service_name: string
          snapshot_version: number
          subtotal_cents: number
          unit_price_cents: number
          xero_code: string | null
        }
        Insert: {
          cost_share_cents?: number
          created_at?: string
          dept_id: string
          dept_name: string
          hours?: number
          id?: string
          ordinal: number
          qty: number
          quote_id: string
          service_id: string
          service_name: string
          snapshot_version?: number
          subtotal_cents: number
          unit_price_cents: number
          xero_code?: string | null
        }
        Update: {
          cost_share_cents?: number
          created_at?: string
          dept_id?: string
          dept_name?: string
          hours?: number
          id?: string
          ordinal?: number
          qty?: number
          quote_id?: string
          service_id?: string
          service_name?: string
          snapshot_version?: number
          subtotal_cents?: number
          unit_price_cents?: number
          xero_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_item_allocations_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_item_allocations_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_item_allocations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "quote_line_item_allocations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_service_overrides: {
        Row: {
          created_at: string
          dept_id: string
          hours_override: number | null
          pct_override: number | null
          quote_service_id: string
        }
        Insert: {
          created_at?: string
          dept_id: string
          hours_override?: number | null
          pct_override?: number | null
          quote_service_id: string
        }
        Update: {
          created_at?: string
          dept_id?: string
          hours_override?: number | null
          pct_override?: number | null
          quote_service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_service_overrides_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_service_overrides_quote_service_id_fkey"
            columns: ["quote_service_id"]
            isOneToOne: false
            referencedRelation: "quote_services"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_services: {
        Row: {
          created_at: string
          id: string
          is_recurring: boolean
          notes: string | null
          ordinal: number
          qty: number
          quote_id: string
          recurrence_end: string | null
          recurrence_interval:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_start: string | null
          service_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          ordinal: number
          qty?: number
          quote_id: string
          recurrence_end?: string | null
          recurrence_interval?:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_start?: string | null
          service_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          ordinal?: number
          qty?: number
          quote_id?: string
          recurrence_end?: string | null
          recurrence_interval?:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_start?: string | null
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_services_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "quote_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          discount_room_pct: number
          id: string
          is_recurring: boolean
          margin_pct: number
          recurrence_end: string | null
          recurrence_interval:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_mode: Database["public"]["Enums"]["recurrence_mode"]
          recurrence_start: string | null
          rejection_reason: string | null
          scope_id: string
          sent_at: string | null
          sow_html: string | null
          sow_pdf_url: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal_cents: number
          total_cents: number
          updated_at: string
          version: number
          xero_quote_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          discount_room_pct?: number
          id?: string
          is_recurring?: boolean
          margin_pct?: number
          recurrence_end?: string | null
          recurrence_interval?:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_mode?: Database["public"]["Enums"]["recurrence_mode"]
          recurrence_start?: string | null
          rejection_reason?: string | null
          scope_id: string
          sent_at?: string | null
          sow_html?: string | null
          sow_pdf_url?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          version?: number
          xero_quote_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          discount_room_pct?: number
          id?: string
          is_recurring?: boolean
          margin_pct?: number
          recurrence_end?: string | null
          recurrence_interval?:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_mode?: Database["public"]["Enums"]["recurrence_mode"]
          recurrence_start?: string | null
          rejection_reason?: string | null
          scope_id?: string
          sent_at?: string | null
          sow_html?: string | null
          sow_pdf_url?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          version?: number
          xero_quote_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "scopes"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_task_schedules: {
        Row: {
          clickup_list_id: string
          clickup_parent_task_id: string
          created_at: string
          dept_id: string
          id: string
          last_created_at: string | null
          next_due_at: string
          planned_hours: number
          project_id: string
          recurrence_anchor: string
          recurrence_interval: Database["public"]["Enums"]["recurrence_interval"]
          service_id: string
          source: string
          status: string
        }
        Insert: {
          clickup_list_id: string
          clickup_parent_task_id: string
          created_at?: string
          dept_id: string
          id?: string
          last_created_at?: string | null
          next_due_at: string
          planned_hours: number
          project_id: string
          recurrence_anchor: string
          recurrence_interval: Database["public"]["Enums"]["recurrence_interval"]
          service_id: string
          source?: string
          status?: string
        }
        Update: {
          clickup_list_id?: string
          clickup_parent_task_id?: string
          created_at?: string
          dept_id?: string
          id?: string
          last_created_at?: string | null
          next_due_at?: string
          planned_hours?: number
          project_id?: string
          recurrence_anchor?: string
          recurrence_interval?: Database["public"]["Enums"]["recurrence_interval"]
          service_id?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_task_schedules_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_task_schedules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_task_schedules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "recurring_task_schedules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      relay_secrets: {
        Row: {
          created_at: string
          id: string
          revoked_at: string | null
          secret: string
          user_email: string
        }
        Insert: {
          created_at?: string
          id?: string
          revoked_at?: string | null
          secret: string
          user_email: string
        }
        Update: {
          created_at?: string
          id?: string
          revoked_at?: string | null
          secret?: string
          user_email?: string
        }
        Relationships: []
      }
      rule_allocations: {
        Row: {
          department_id: string
          pct: number
          rule_id: string
        }
        Insert: {
          department_id: string
          pct: number
          rule_id: string
        }
        Update: {
          department_id?: string
          pct?: number
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_allocations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_allocations_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      rules: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      scopes: {
        Row: {
          ai_context_snapshot: string | null
          ai_drafted: boolean
          brief_id: string
          created_at: string
          enhanced_prose: string | null
          id: string
          in_scope_md: string | null
          locked_at: string | null
          locked_by: string | null
          open_questions_md: string | null
          out_of_scope_md: string | null
          scope_type: string | null
          updated_at: string
        }
        Insert: {
          ai_context_snapshot?: string | null
          ai_drafted?: boolean
          brief_id: string
          created_at?: string
          enhanced_prose?: string | null
          id?: string
          in_scope_md?: string | null
          locked_at?: string | null
          locked_by?: string | null
          open_questions_md?: string | null
          out_of_scope_md?: string | null
          scope_type?: string | null
          updated_at?: string
        }
        Update: {
          ai_context_snapshot?: string | null
          ai_drafted?: boolean
          brief_id?: string
          created_at?: string
          enhanced_prose?: string | null
          id?: string
          in_scope_md?: string | null
          locked_at?: string | null
          locked_by?: string | null
          open_questions_md?: string | null
          out_of_scope_md?: string | null
          scope_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scopes_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: true
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scopes_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      service_children: {
        Row: {
          child_id: string
          created_at: string
          ordinal: number
          parent_id: string
          quantity: number
        }
        Insert: {
          child_id: string
          created_at?: string
          ordinal: number
          parent_id: string
          quantity?: number
        }
        Update: {
          child_id?: string
          created_at?: string
          ordinal?: number
          parent_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_children_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "service_children_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_children_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "service_children_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          code: string | null
          completion_definition: string | null
          created_at: string
          default_due_days: number | null
          id: string
          included_revisions: string | null
          name: string
          notes: string | null
          owner_role: string | null
          percentage_value: number | null
          pricing_model: string
          primary_team_member_id: string | null
          rule_id: string | null
          scope_definition: string | null
          sell_price_cents: number
          status: string
          trigger_to_start: string | null
          unit_of_sale: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          completion_definition?: string | null
          created_at?: string
          default_due_days?: number | null
          id?: string
          included_revisions?: string | null
          name: string
          notes?: string | null
          owner_role?: string | null
          percentage_value?: number | null
          pricing_model: string
          primary_team_member_id?: string | null
          rule_id?: string | null
          scope_definition?: string | null
          sell_price_cents?: number
          status?: string
          trigger_to_start?: string | null
          unit_of_sale?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          completion_definition?: string | null
          created_at?: string
          default_due_days?: number | null
          id?: string
          included_revisions?: string | null
          name?: string
          notes?: string | null
          owner_role?: string | null
          percentage_value?: number | null
          pricing_model?: string
          primary_team_member_id?: string | null
          rule_id?: string | null
          scope_definition?: string | null
          sell_price_cents?: number
          status?: string
          trigger_to_start?: string | null
          unit_of_sale?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_primary_team_member_id_fkey"
            columns: ["primary_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          anthropic_enabled: boolean
          anthropic_model: string
          clickup_clients_space_id: string | null
          clickup_enabled: boolean
          clickup_workspace_id: string | null
          id: number
          inbound_email_secret: string | null
          unallocated_ai_clickup_task_id: string | null
          updated_at: string
          xero_enabled: boolean
          xero_oauth_tokens: Json | null
        }
        Insert: {
          anthropic_enabled?: boolean
          anthropic_model?: string
          clickup_clients_space_id?: string | null
          clickup_enabled?: boolean
          clickup_workspace_id?: string | null
          id?: number
          inbound_email_secret?: string | null
          unallocated_ai_clickup_task_id?: string | null
          updated_at?: string
          xero_enabled?: boolean
          xero_oauth_tokens?: Json | null
        }
        Update: {
          anthropic_enabled?: boolean
          anthropic_model?: string
          clickup_clients_space_id?: string | null
          clickup_enabled?: boolean
          clickup_workspace_id?: string | null
          id?: number
          inbound_email_secret?: string | null
          unallocated_ai_clickup_task_id?: string | null
          updated_at?: string
          xero_enabled?: boolean
          xero_oauth_tokens?: Json | null
        }
        Relationships: []
      }
      team_member_departments: {
        Row: {
          department_id: string
          team_member_id: string
        }
        Insert: {
          department_id: string
          team_member_id: string
        }
        Update: {
          department_id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_member_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_member_departments_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      xero_connection: {
        Row: {
          access_token: string
          expires_at: string
          id: string
          refresh_token: string
          tenant_id: string
          tenant_name: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at: string
          id?: string
          refresh_token: string
          tenant_id: string
          tenant_name?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          tenant_id?: string
          tenant_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      xero_invoices: {
        Row: {
          amount_cents: number
          client_id: string | null
          created_at: string
          due_date: string | null
          id: string
          invoice_number: string | null
          paid_at: string | null
          project_id: string | null
          status: "DRAFT" | "SUBMITTED" | "AUTHORISED" | "PAID" | "VOIDED"
          synced_at: string
          xero_contact_id: string | null
          xero_contact_name: string | null
          xero_invoice_id: string
        }
        Insert: {
          amount_cents?: number
          client_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          project_id?: string | null
          status: "DRAFT" | "SUBMITTED" | "AUTHORISED" | "PAID" | "VOIDED"
          synced_at?: string
          xero_contact_id?: string | null
          xero_contact_name?: string | null
          xero_invoice_id: string
        }
        Update: {
          amount_cents?: number
          client_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          project_id?: string | null
          status?: "DRAFT" | "SUBMITTED" | "AUTHORISED" | "PAID" | "VOIDED"
          synced_at?: string
          xero_contact_id?: string | null
          xero_contact_name?: string | null
          xero_invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xero_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xero_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          archived_at: string | null
          clickup_user_id: number | null
          cost_rate_cents: number | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          primary_department_id: string | null
          skills: string[]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          clickup_user_id?: number | null
          cost_rate_cents?: number | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          primary_department_id?: string | null
          skills?: string[]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          clickup_user_id?: number | null
          cost_rate_cents?: number | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          primary_department_id?: string | null
          skills?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_primary_department_id_fkey"
            columns: ["primary_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      project_actuals_current: {
        Row: {
          actual_hours: number | null
          clickup_task_id: string | null
          cost_cents: number | null
          dept_id: string | null
          id: string | null
          planned_hours: number | null
          project_id: string | null
          recorded_at: string | null
          status_at_sync: string | null
          synced_at: string | null
          time_entries: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "project_actuals_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_actuals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      service_allocation_resolved: {
        Row: {
          department_id: string | null
          hours: number | null
          pct: number | null
          price_share_cents: number | null
          service_id: string | null
        }
        Relationships: []
      }
      service_totals: {
        Row: {
          service_id: string | null
          total_hours: number | null
          total_price_cents: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      generate_project_code: { Args: never; Returns: string }
      normalise_git_remote: { Args: { remote: string }; Returns: string }
      resolve_project_for_repo: {
        Args: { remote: string }
        Returns: {
          calculator_project_id: string
          clickup_parent_task_id: string
          project_code: string
          project_name: string
        }[]
      }
    }
    Enums: {
      brief_source: "email" | "manual" | "gmail_relay"
      brief_status:
        | "new"
        | "triaged"
        | "spam"
        | "needs_info"
        | "scoped"
        | "quoted"
        | "accepted"
        | "rejected"
        | "archived"
      project_status: "in_progress" | "completed" | "cancelled"
      quote_status: "draft" | "sent" | "accepted" | "rejected" | "superseded"
      recurrence_interval: "weekly" | "biweekly" | "monthly" | "quarterly"
      recurrence_mode: "none" | "project" | "per_service"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      brief_source: ["email", "manual", "gmail_relay"],
      brief_status: [
        "new",
        "triaged",
        "spam",
        "needs_info",
        "scoped",
        "quoted",
        "accepted",
        "rejected",
        "archived",
      ],
      project_status: ["in_progress", "completed", "cancelled"],
      quote_status: ["draft", "sent", "accepted", "rejected", "superseded"],
      recurrence_interval: ["weekly", "biweekly", "monthly", "quarterly"],
      recurrence_mode: ["none", "project", "per_service"],
    },
  },
} as const
