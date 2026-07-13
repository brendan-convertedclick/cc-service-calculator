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
      agents: {
        Row: {
          created_at: string
          creator: string
          description: string
          estimated_human_hours_per_run: number
          id: string
          name: string
        }
        Insert: {
          created_at: string
          creator: string
          description: string
          estimated_human_hours_per_run?: number
          id: string
          name: string
        }
        Update: {
          created_at?: string
          creator?: string
          description?: string
          estimated_human_hours_per_run?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      ai_sessions: {
        Row: {
          agent_id: string | null
          ai_cost_zar: number
          ai_duration_minutes: number
          ai_input_tokens: number
          ai_output_tokens: number
          clickup_task_id: string | null
          concurrent_sessions: number
          created_at: string
          engagement_type: string
          human_minutes: number
          id: string
          jsonl_id: string | null
          logged_by: string
          project_slug: string | null
          session_date: string
        }
        Insert: {
          agent_id?: string | null
          ai_cost_zar?: number
          ai_duration_minutes?: number
          ai_input_tokens?: number
          ai_output_tokens?: number
          clickup_task_id?: string | null
          concurrent_sessions?: number
          created_at?: string
          engagement_type?: string
          human_minutes?: number
          id?: string
          jsonl_id?: string | null
          logged_by: string
          project_slug?: string | null
          session_date: string
        }
        Update: {
          agent_id?: string | null
          ai_cost_zar?: number
          ai_duration_minutes?: number
          ai_input_tokens?: number
          ai_output_tokens?: number
          clickup_task_id?: string | null
          concurrent_sessions?: number
          created_at?: string
          engagement_type?: string
          human_minutes?: number
          id?: string
          jsonl_id?: string | null
          logged_by?: string
          project_slug?: string | null
          session_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      baseline_lists: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          display_order: number
          group_id: string
          id: string
          label: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          group_id: string
          id?: string
          label: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          group_id?: string
          id?: string
          label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "baseline_lists_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "task_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      baseline_tasks: {
        Row: {
          archived_at: string | null
          baseline_list_id: string
          created_at: string
          description: string | null
          display_order: number
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          baseline_list_id: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          baseline_list_id?: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "baseline_tasks_baseline_list_id_fkey"
            columns: ["baseline_list_id"]
            isOneToOne: false
            referencedRelation: "baseline_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_tasks_baseline_list_id_fkey"
            columns: ["baseline_list_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["baseline_list_id"]
          },
        ]
      }
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
          suggested_services: Json | null
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
          suggested_services?: Json | null
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
          suggested_services?: Json | null
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
      brief_task_sow_placements: {
        Row: {
          ai_confidence: number | null
          ai_match_quote: string | null
          approved_at: string | null
          approved_by: string | null
          brief_id: string
          created_at: string
          disposition: string | null
          estimated_cents: number | null
          grounding_quote: string | null
          id: string
          is_inside: boolean
          item_description: string | null
          item_name: string | null
          needs_review: boolean | null
          override_reason: string | null
          quantity: number | null
          service_area_id: string | null
          sow_slug: string | null
          suggested_service_id: string | null
          task_ref: string
          updated_at: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_match_quote?: string | null
          approved_at?: string | null
          approved_by?: string | null
          brief_id: string
          created_at?: string
          disposition?: string | null
          estimated_cents?: number | null
          grounding_quote?: string | null
          id?: string
          is_inside: boolean
          item_description?: string | null
          item_name?: string | null
          needs_review?: boolean | null
          override_reason?: string | null
          quantity?: number | null
          service_area_id?: string | null
          sow_slug?: string | null
          suggested_service_id?: string | null
          task_ref: string
          updated_at?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_match_quote?: string | null
          approved_at?: string | null
          approved_by?: string | null
          brief_id?: string
          created_at?: string
          disposition?: string | null
          estimated_cents?: number | null
          grounding_quote?: string | null
          id?: string
          is_inside?: boolean
          item_description?: string | null
          item_name?: string | null
          needs_review?: boolean | null
          override_reason?: string | null
          quantity?: number | null
          service_area_id?: string | null
          sow_slug?: string | null
          suggested_service_id?: string | null
          task_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_task_sow_placements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_task_sow_placements_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_task_sow_placements_service_area_id_fkey"
            columns: ["service_area_id"]
            isOneToOne: false
            referencedRelation: "sow_service_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_task_sow_placements_sow_slug_fkey"
            columns: ["sow_slug"]
            isOneToOne: false
            referencedRelation: "master_sows"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "brief_task_sow_placements_suggested_service_id_fkey"
            columns: ["suggested_service_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "brief_task_sow_placements_suggested_service_id_fkey"
            columns: ["suggested_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      briefs: {
        Row: {
          assignee_id: string | null
          clickup_task_id: string | null
          clickup_task_url: string | null
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
          quick_task_suggestion: Json | null
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
          clickup_task_id?: string | null
          clickup_task_url?: string | null
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
          quick_task_suggestion?: Json | null
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
          clickup_task_id?: string | null
          clickup_task_url?: string | null
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
          quick_task_suggestion?: Json | null
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
            foreignKeyName: "briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
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
      change_estimate_line_items: {
        Row: {
          change_estimate_id: string
          description: string
          id: string
          line_kind: string
          qty: number
          service_id: string | null
          sort_order: number
          target_task_id: string | null
          unit_points: number
          unit_value_cents: number
        }
        Insert: {
          change_estimate_id: string
          description: string
          id?: string
          line_kind: string
          qty?: number
          service_id?: string | null
          sort_order?: number
          target_task_id?: string | null
          unit_points: number
          unit_value_cents: number
        }
        Update: {
          change_estimate_id?: string
          description?: string
          id?: string
          line_kind?: string
          qty?: number
          service_id?: string | null
          sort_order?: number
          target_task_id?: string | null
          unit_points?: number
          unit_value_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "change_estimate_line_items_change_estimate_id_fkey"
            columns: ["change_estimate_id"]
            isOneToOne: false
            referencedRelation: "change_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_estimate_line_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "change_estimate_line_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      change_estimates: {
        Row: {
          approval_note: string | null
          approved_at: string | null
          approver_email: string | null
          brief_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          delta_points: number
          delta_value_cents: number
          external_approval_id: string | null
          id: string
          outbound_email_id: string | null
          project_id: string | null
          reason: string | null
          rejected_at: string | null
          rejected_reason: string | null
          source: string
          status: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          approval_note?: string | null
          approved_at?: string | null
          approver_email?: string | null
          brief_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          delta_points?: number
          delta_value_cents?: number
          external_approval_id?: string | null
          id?: string
          outbound_email_id?: string | null
          project_id?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_reason?: string | null
          source: string
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          approval_note?: string | null
          approved_at?: string | null
          approver_email?: string | null
          brief_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          delta_points?: number
          delta_value_cents?: number
          external_approval_id?: string | null
          id?: string
          outbound_email_id?: string | null
          project_id?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_reason?: string | null
          source?: string
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_estimates_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_estimates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_estimates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "change_estimates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_estimates_outbound_email_id_fkey"
            columns: ["outbound_email_id"]
            isOneToOne: false
            referencedRelation: "outbound_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clause_schema: {
        Row: {
          key: string
          label: string
          merge_strategy: string
          section: string
          sort_order: number
          value_type: string
        }
        Insert: {
          key: string
          label: string
          merge_strategy?: string
          section: string
          sort_order?: number
          value_type: string
        }
        Update: {
          key?: string
          label?: string
          merge_strategy?: string
          section?: string
          sort_order?: number
          value_type?: string
        }
        Relationships: []
      }
      clause_values: {
        Row: {
          clause_key: string
          id: string
          level_id: string
          scope_id: string | null
          updated_at: string
          value_bool: boolean | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          clause_key: string
          id?: string
          level_id: string
          scope_id?: string | null
          updated_at?: string
          value_bool?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          clause_key?: string
          id?: string
          level_id?: string
          scope_id?: string | null
          updated_at?: string
          value_bool?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clause_values_clause_key_fkey"
            columns: ["clause_key"]
            isOneToOne: false
            referencedRelation: "clause_schema"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "clause_values_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "sow_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      clickup_user_tokens: {
        Row: {
          access_token: string
          clickup_user_id: string | null
          clickup_username: string | null
          connected_at: string
          id: string
          team_member_id: string
        }
        Insert: {
          access_token: string
          clickup_user_id?: string | null
          clickup_username?: string | null
          connected_at?: string
          id?: string
          team_member_id: string
        }
        Update: {
          access_token?: string
          clickup_user_id?: string | null
          clickup_username?: string | null
          connected_at?: string
          id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clickup_user_tokens_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: true
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      client_baseline_tasks_log: {
        Row: {
          baseline_task_id: string
          clickup_task_id: string
          client_id: string
          created_at: string
          id: string
        }
        Insert: {
          baseline_task_id: string
          clickup_task_id: string
          client_id: string
          created_at?: string
          id?: string
        }
        Update: {
          baseline_task_id?: string
          clickup_task_id?: string
          client_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_baseline_tasks_log_baseline_task_id_fkey"
            columns: ["baseline_task_id"]
            isOneToOne: false
            referencedRelation: "baseline_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_baseline_tasks_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_baseline_tasks_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_lists: {
        Row: {
          archived_at: string | null
          clickup_list_id: string
          clickup_list_name: string
          client_id: string
          created_at: string
          custom_label: string | null
          discovered_at: string | null
          group_id: string | null
          id: string
        }
        Insert: {
          archived_at?: string | null
          clickup_list_id: string
          clickup_list_name: string
          client_id: string
          created_at?: string
          custom_label?: string | null
          discovered_at?: string | null
          group_id?: string | null
          id?: string
        }
        Update: {
          archived_at?: string | null
          clickup_list_id?: string
          clickup_list_name?: string
          client_id?: string
          created_at?: string
          custom_label?: string | null
          discovered_at?: string | null
          group_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_lists_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_lists_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_lists_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "task_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      client_sender_rules: {
        Row: {
          client_id: string
          created_at: string
          id: string
          mode: Database["public"]["Enums"]["sender_rule_mode"]
          note: string | null
          pattern: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          mode: Database["public"]["Enums"]["sender_rule_mode"]
          note?: string | null
          pattern: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["sender_rule_mode"]
          note?: string | null
          pattern?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_sender_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sender_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_sows: {
        Row: {
          client_id: string
          created_at: string
          sow_slug: string
          status: string
        }
        Insert: {
          client_id: string
          created_at?: string
          sow_slug: string
          status?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          sow_slug?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_sows_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_sows_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_sows_sow_slug_fkey"
            columns: ["sow_slug"]
            isOneToOne: false
            referencedRelation: "master_sows"
            referencedColumns: ["slug"]
          },
        ]
      }
      client_touchpoints: {
        Row: {
          client_id: string
          created_at: string
          id: string
          notes: string | null
          occurred_at: string
          type: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          type: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_touchpoints_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_touchpoints_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          clickup_chat_channel_id: string | null
          clickup_client_name: string | null
          clickup_folder_id: string | null
          created_at: string
          id: string
          margin_target_pct: number | null
          name: string
          notes: string | null
          primary_domain: string | null
          short_name: string
          updated_at: string
          wiki_path: string | null
          xero_contact_id: string | null
        }
        Insert: {
          archived_at?: string | null
          clickup_chat_channel_id?: string | null
          clickup_client_name?: string | null
          clickup_folder_id?: string | null
          created_at?: string
          id?: string
          margin_target_pct?: number | null
          name: string
          notes?: string | null
          primary_domain?: string | null
          short_name: string
          updated_at?: string
          wiki_path?: string | null
          xero_contact_id?: string | null
        }
        Update: {
          archived_at?: string | null
          clickup_chat_channel_id?: string | null
          clickup_client_name?: string | null
          clickup_folder_id?: string | null
          created_at?: string
          id?: string
          margin_target_pct?: number | null
          name?: string
          notes?: string | null
          primary_domain?: string | null
          short_name?: string
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
          {
            foreignKeyName: "contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
        ]
      }
      departments: {
        Row: {
          archived_at: string | null
          clickup_work_stream: string | null
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
          clickup_work_stream?: string | null
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
          clickup_work_stream?: string | null
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
      email_templates: {
        Row: {
          body_html: string
          body_text: string
          created_at: string
          id: string
          name: string
          slug: string
          subject: string
          updated_at: string
          variables: string[]
        }
        Insert: {
          body_html: string
          body_text: string
          created_at?: string
          id?: string
          name: string
          slug: string
          subject: string
          updated_at?: string
          variables?: string[]
        }
        Update: {
          body_html?: string
          body_text?: string
          created_at?: string
          id?: string
          name?: string
          slug?: string
          subject?: string
          updated_at?: string
          variables?: string[]
        }
        Relationships: []
      }
      extension_requests: {
        Row: {
          approved_at: string | null
          approver_id: string | null
          clickup_subtask_id: string | null
          clickup_subtask_url: string | null
          client_id: string
          created_at: string
          delta_pct: number
          extra_points: number
          id: string
          original_points: number
          parent_clickup_task_id: string
          parent_task_name: string
          reason: string
          rejected_reason: string | null
          requester_id: string
          status: string
          tier: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approver_id?: string | null
          clickup_subtask_id?: string | null
          clickup_subtask_url?: string | null
          client_id: string
          created_at?: string
          delta_pct: number
          extra_points: number
          id?: string
          original_points: number
          parent_clickup_task_id: string
          parent_task_name: string
          reason: string
          rejected_reason?: string | null
          requester_id: string
          status: string
          tier: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approver_id?: string | null
          clickup_subtask_id?: string | null
          clickup_subtask_url?: string | null
          client_id?: string
          created_at?: string
          delta_pct?: number
          extra_points?: number
          id?: string
          original_points?: number
          parent_clickup_task_id?: string
          parent_task_name?: string
          reason?: string
          rejected_reason?: string | null
          requester_id?: string
          status?: string
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extension_requests_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extension_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extension_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "extension_requests_requester_id_fkey"
            columns: ["requester_id"]
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
          {
            foreignKeyName: "list_alias_overrides_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
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
      ongoing_actuals: {
        Row: {
          clickup_task_id: string
          cumulative_hours: number
          id: string
          ongoing_task_id: string
          synced_at: string
          time_entries: Json | null
        }
        Insert: {
          clickup_task_id: string
          cumulative_hours?: number
          id?: string
          ongoing_task_id: string
          synced_at?: string
          time_entries?: Json | null
        }
        Update: {
          clickup_task_id?: string
          cumulative_hours?: number
          id?: string
          ongoing_task_id?: string
          synced_at?: string
          time_entries?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ongoing_actuals_ongoing_task_id_fkey"
            columns: ["ongoing_task_id"]
            isOneToOne: false
            referencedRelation: "ongoing_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      ongoing_tasks: {
        Row: {
          archived_at: string | null
          billable: boolean | null
          clickup_task_id: string
          client_id: string | null
          client_list_id: string | null
          id: string
          provisioned_at: string
          task_name: string
          team_member_id: string
          time_category_id: string
        }
        Insert: {
          archived_at?: string | null
          billable?: boolean | null
          clickup_task_id: string
          client_id?: string | null
          client_list_id?: string | null
          id?: string
          provisioned_at?: string
          task_name: string
          team_member_id: string
          time_category_id: string
        }
        Update: {
          archived_at?: string | null
          billable?: boolean | null
          clickup_task_id?: string
          client_id?: string | null
          client_list_id?: string | null
          id?: string
          provisioned_at?: string
          task_name?: string
          team_member_id?: string
          time_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ongoing_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ongoing_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ongoing_tasks_client_list_id_fkey"
            columns: ["client_list_id"]
            isOneToOne: false
            referencedRelation: "client_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ongoing_tasks_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ongoing_tasks_time_category_id_fkey"
            columns: ["time_category_id"]
            isOneToOne: false
            referencedRelation: "time_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_emails: {
        Row: {
          approval_link: string | null
          bcc_addresses: string[]
          body_html: string
          body_text: string
          brief_id: string | null
          cc_addresses: string[]
          client_id: string | null
          composed_by: string
          created_at: string
          drive_link: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          project_id: string | null
          send_error: string | null
          sent_at: string | null
          status: string
          subject: string
          template: string | null
          to_addresses: string[]
          updated_at: string
        }
        Insert: {
          approval_link?: string | null
          bcc_addresses?: string[]
          body_html: string
          body_text: string
          brief_id?: string | null
          cc_addresses?: string[]
          client_id?: string | null
          composed_by: string
          created_at?: string
          drive_link?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          project_id?: string | null
          send_error?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          template?: string | null
          to_addresses: string[]
          updated_at?: string
        }
        Update: {
          approval_link?: string | null
          bcc_addresses?: string[]
          body_html?: string
          body_text?: string
          brief_id?: string | null
          cc_addresses?: string[]
          client_id?: string | null
          composed_by?: string
          created_at?: string
          drive_link?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          project_id?: string | null
          send_error?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          template?: string | null
          to_addresses?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_emails_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_emails_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_emails_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "outbound_emails_composed_by_fkey"
            columns: ["composed_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_emails_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_clients: {
        Row: {
          dismissed_at: string | null
          domain: string
          first_seen_at: string
          id: string
          last_seen_at: string
          sample_sender: string | null
          sample_subject: string | null
          seen_count: number
        }
        Insert: {
          dismissed_at?: string | null
          domain: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          sample_sender?: string | null
          sample_subject?: string | null
          seen_count?: number
        }
        Update: {
          dismissed_at?: string | null
          domain?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          sample_sender?: string | null
          sample_subject?: string | null
          seen_count?: number
        }
        Relationships: []
      }
      pending_senders: {
        Row: {
          client_id: string
          email: string
          first_seen_at: string
          id: string
          last_seen_at: string
          sample_brief_id: string | null
          sample_subject: string | null
          seen_count: number
        }
        Insert: {
          client_id: string
          email: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          sample_brief_id?: string | null
          sample_subject?: string | null
          seen_count?: number
        }
        Update: {
          client_id?: string
          email?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          sample_brief_id?: string | null
          sample_subject?: string | null
          seen_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "pending_senders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_senders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "pending_senders_sample_brief_id_fkey"
            columns: ["sample_brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      process_step_instances: {
        Row: {
          actual_hours: number
          assignee_id: string | null
          blocked_reason: string | null
          clickup_task_id: string | null
          completed_at: string | null
          created_at: string
          department_id: string | null
          description: string | null
          due_at: string | null
          estimated_hours: number | null
          id: string
          last_synced_at: string | null
          manual_override: boolean
          ordinal: number
          project_id: string
          service_id: string | null
          started_at: string | null
          status: string
          template_step_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          actual_hours?: number
          assignee_id?: string | null
          blocked_reason?: string | null
          clickup_task_id?: string | null
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          description?: string | null
          due_at?: string | null
          estimated_hours?: number | null
          id?: string
          last_synced_at?: string | null
          manual_override?: boolean
          ordinal: number
          project_id: string
          service_id?: string | null
          started_at?: string | null
          status?: string
          template_step_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          actual_hours?: number
          assignee_id?: string | null
          blocked_reason?: string | null
          clickup_task_id?: string | null
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          description?: string | null
          due_at?: string | null
          estimated_hours?: number | null
          id?: string
          last_synced_at?: string | null
          manual_override?: boolean
          ordinal?: number
          project_id?: string
          service_id?: string | null
          started_at?: string | null
          status?: string
          template_step_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_step_instances_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_step_instances_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_step_instances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_step_instances_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "process_step_instances_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_step_instances_template_step_id_fkey"
            columns: ["template_step_id"]
            isOneToOne: false
            referencedRelation: "process_steps"
            referencedColumns: ["id"]
          },
        ]
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
          cost_cents: number | null
          dept_id: string | null
          id: string
          is_productized: boolean | null
          planned_hours: number
          project_id: string
          recorded_at: string
          status_at_sync: string | null
          synced_at: string
          task_name: string | null
          time_entries: Json | null
        }
        Insert: {
          actual_hours?: number
          clickup_task_id: string
          cost_cents?: number | null
          dept_id?: string | null
          id?: string
          is_productized?: boolean | null
          planned_hours: number
          project_id: string
          recorded_at?: string
          status_at_sync?: string | null
          synced_at?: string
          task_name?: string | null
          time_entries?: Json | null
        }
        Update: {
          actual_hours?: number
          clickup_task_id?: string
          cost_cents?: number | null
          dept_id?: string | null
          id?: string
          is_productized?: boolean | null
          planned_hours?: number
          project_id?: string
          recorded_at?: string
          status_at_sync?: string | null
          synced_at?: string
          task_name?: string | null
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
      project_events: {
        Row: {
          actor_team_member_id: string | null
          clickup_task_id: string | null
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          project_id: string
          synced_at: string
        }
        Insert: {
          actor_team_member_id?: string | null
          clickup_task_id?: string | null
          event_type: string
          id?: string
          occurred_at: string
          payload?: Json
          project_id: string
          synced_at?: string
        }
        Update: {
          actor_team_member_id?: string | null
          clickup_task_id?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          project_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_events_actor_team_member_id_fkey"
            columns: ["actor_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_problems: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          details: Json
          first_detected_at: string
          id: string
          last_detected_at: string
          problem_type: string
          project_id: string
          resolved_at: string | null
          severity: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          details?: Json
          first_detected_at?: string
          id?: string
          last_detected_at?: string
          problem_type: string
          project_id: string
          resolved_at?: string | null
          severity: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          details?: Json
          first_detected_at?: string
          id?: string
          last_detected_at?: string
          problem_type?: string
          project_id?: string
          resolved_at?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_problems_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_problems_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          clickup_list_id: string | null
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
          quote_id: string | null
          recurrence_end: string | null
          recurrence_interval:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_mode: Database["public"]["Enums"]["recurrence_mode"]
          recurrence_start: string | null
          retainer_hours_target: number | null
          retainer_monthly_fee_cents: number | null
          scope_status: string
          started_at: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          xero_invoice_id: string | null
        }
        Insert: {
          clickup_list_id?: string | null
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
          quote_id?: string | null
          recurrence_end?: string | null
          recurrence_interval?:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_mode?: Database["public"]["Enums"]["recurrence_mode"]
          recurrence_start?: string | null
          retainer_hours_target?: number | null
          retainer_monthly_fee_cents?: number | null
          scope_status?: string
          started_at?: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          xero_invoice_id?: string | null
        }
        Update: {
          clickup_list_id?: string | null
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
          quote_id?: string | null
          recurrence_end?: string | null
          recurrence_interval?:
            | Database["public"]["Enums"]["recurrence_interval"]
            | null
          recurrence_mode?: Database["public"]["Enums"]["recurrence_mode"]
          recurrence_start?: string | null
          retainer_hours_target?: number | null
          retainer_monthly_fee_cents?: number | null
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
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
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
      provisioned_tasks: {
        Row: {
          assignee_id: string
          clickup_task_ids: string[]
          created_at: string
          id: string
          mode: string
          period_end: string
          period_start: string
          project_id: string
          recurring_service_id: string
        }
        Insert: {
          assignee_id: string
          clickup_task_ids?: string[]
          created_at?: string
          id?: string
          mode: string
          period_end: string
          period_start: string
          project_id: string
          recurring_service_id: string
        }
        Update: {
          assignee_id?: string
          clickup_task_ids?: string[]
          created_at?: string
          id?: string
          mode?: string
          period_end?: string
          period_start?: string
          project_id?: string
          recurring_service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provisioned_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisioned_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provisioned_tasks_recurring_service_id_fkey"
            columns: ["recurring_service_id"]
            isOneToOne: false
            referencedRelation: "retainer_recurring_services"
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
          cost_estimate_pdf_url: string | null
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
          cost_estimate_pdf_url?: string | null
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
          cost_estimate_pdf_url?: string | null
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
      retainer_recurring_services: {
        Row: {
          cadence: string
          checklist_items: string[]
          clickup_task_template_id: string | null
          created_at: string
          default_assignees: string[]
          id: string
          is_live_eligible: boolean
          occurrence_labels: string[]
          occurrences_per_month: number
          points_per_occurrence: number
          project_id: string
          service_id: string
          task_description: string | null
        }
        Insert: {
          cadence: string
          checklist_items?: string[]
          clickup_task_template_id?: string | null
          created_at?: string
          default_assignees?: string[]
          id?: string
          is_live_eligible?: boolean
          occurrence_labels?: string[]
          occurrences_per_month: number
          points_per_occurrence: number
          project_id: string
          service_id: string
          task_description?: string | null
        }
        Update: {
          cadence?: string
          checklist_items?: string[]
          clickup_task_template_id?: string | null
          created_at?: string
          default_assignees?: string[]
          id?: string
          is_live_eligible?: boolean
          occurrence_labels?: string[]
          occurrences_per_month?: number
          points_per_occurrence?: number
          project_id?: string
          service_id?: string
          task_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retainer_recurring_services_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retainer_recurring_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "retainer_recurring_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
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
          clickup_work_stream: string | null
          code: string | null
          completion_definition: string | null
          created_at: string
          default_due_days: number | null
          id: string
          included_revisions: string | null
          is_deliverable: boolean
          is_productized: boolean
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
          clickup_work_stream?: string | null
          code?: string | null
          completion_definition?: string | null
          created_at?: string
          default_due_days?: number | null
          id?: string
          included_revisions?: string | null
          is_deliverable?: boolean
          is_productized?: boolean
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
          clickup_work_stream?: string | null
          code?: string | null
          completion_definition?: string | null
          created_at?: string
          default_due_days?: number | null
          id?: string
          included_revisions?: string | null
          is_deliverable?: boolean
          is_productized?: boolean
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
          account_manager_email: string
          anthropic_enabled: boolean
          anthropic_model: string
          approval_program_base_url: string | null
          blended_hourly_rate_zar: number
          clickup_clients_space_id: string | null
          clickup_enabled: boolean
          clickup_internal_list_id: string | null
          clickup_workspace_id: string | null
          id: number
          inbound_email_secret: string | null
          productivity_goal_points: number
          standard_point_rate_cents: number | null
          unallocated_ai_clickup_task_id: string | null
          updated_at: string
          waiting_on_client_statuses: string[]
          xero_enabled: boolean
          xero_oauth_tokens: Json | null
          zar_per_point: number
        }
        Insert: {
          account_manager_email?: string
          anthropic_enabled?: boolean
          anthropic_model?: string
          approval_program_base_url?: string | null
          blended_hourly_rate_zar?: number
          clickup_clients_space_id?: string | null
          clickup_enabled?: boolean
          clickup_internal_list_id?: string | null
          clickup_workspace_id?: string | null
          id?: number
          inbound_email_secret?: string | null
          productivity_goal_points?: number
          standard_point_rate_cents?: number | null
          unallocated_ai_clickup_task_id?: string | null
          updated_at?: string
          waiting_on_client_statuses?: string[]
          xero_enabled?: boolean
          xero_oauth_tokens?: Json | null
          zar_per_point?: number
        }
        Update: {
          account_manager_email?: string
          anthropic_enabled?: boolean
          anthropic_model?: string
          approval_program_base_url?: string | null
          blended_hourly_rate_zar?: number
          clickup_clients_space_id?: string | null
          clickup_enabled?: boolean
          clickup_internal_list_id?: string | null
          clickup_workspace_id?: string | null
          id?: number
          inbound_email_secret?: string | null
          productivity_goal_points?: number
          standard_point_rate_cents?: number | null
          unallocated_ai_clickup_task_id?: string | null
          updated_at?: string
          waiting_on_client_statuses?: string[]
          xero_enabled?: boolean
          xero_oauth_tokens?: Json | null
          zar_per_point?: number
        }
        Relationships: []
      }
      sow_levels: {
        Row: {
          created_at: string
          id: string
          level_type: string
          name: string
          priority: number
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          level_type: string
          name: string
          priority: number
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          level_type?: string
          name?: string
          priority?: number
          slug?: string
        }
        Relationships: []
      }
      sow_service_areas: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number
          sow_slug: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          sow_slug: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          sow_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "sow_service_areas_sow_slug_fkey"
            columns: ["sow_slug"]
            isOneToOne: false
            referencedRelation: "master_sows"
            referencedColumns: ["slug"]
          },
        ]
      }
      staff_briefs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          auto_approved: boolean
          clickup_list_id: string
          clickup_list_name: string
          clickup_task_id: string | null
          clickup_task_url: string | null
          client_id: string
          created_at: string
          goal: string
          id: string
          is_internal: boolean
          measurable_outcome: string
          rejected_reason: string | null
          sprint_points: number
          status: string
          submitter_id: string
          success_criteria: string
          task_name: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          clickup_list_id: string
          clickup_list_name: string
          clickup_task_id?: string | null
          clickup_task_url?: string | null
          client_id: string
          created_at?: string
          goal: string
          id?: string
          is_internal?: boolean
          measurable_outcome: string
          rejected_reason?: string | null
          sprint_points: number
          status?: string
          submitter_id: string
          success_criteria: string
          task_name: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          clickup_list_id?: string
          clickup_list_name?: string
          clickup_task_id?: string | null
          clickup_task_url?: string | null
          client_id?: string
          created_at?: string
          goal?: string
          id?: string
          is_internal?: boolean
          measurable_outcome?: string
          rejected_reason?: string | null
          sprint_points?: number
          status?: string
          submitter_id?: string
          success_criteria?: string
          task_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_briefs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "staff_briefs_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      task_groups: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          display_order: number
          id: string
          label: string
          label_key: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          label: string
          label_key: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          label?: string
          label_key?: string
          updated_at?: string
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
      team_members: {
        Row: {
          archived_at: string | null
          auth_user_id: string | null
          clickup_user_id: number | null
          cost_rate_cents: number | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          primary_department_id: string | null
          role: string
          skills: string[]
          tracking_mode: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          auth_user_id?: string | null
          clickup_user_id?: number | null
          cost_rate_cents?: number | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          primary_department_id?: string | null
          role?: string
          skills?: string[]
          tracking_mode?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          auth_user_id?: string | null
          clickup_user_id?: number | null
          cost_rate_cents?: number | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          primary_department_id?: string | null
          role?: string
          skills?: string[]
          tracking_mode?: string
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
      time_categories: {
        Row: {
          archived_at: string | null
          billable: boolean
          client_id: string | null
          created_at: string
          description: string | null
          display_order: number
          group_id: string
          id: string
          is_custom: boolean
          label: string
          label_key: string
          updated_at: string
          weekly_budget_hours: number | null
        }
        Insert: {
          archived_at?: string | null
          billable?: boolean
          client_id?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          group_id: string
          id?: string
          is_custom?: boolean
          label: string
          label_key: string
          updated_at?: string
          weekly_budget_hours?: number | null
        }
        Update: {
          archived_at?: string | null
          billable?: boolean
          client_id?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          group_id?: string
          id?: string
          is_custom?: boolean
          label?: string
          label_key?: string
          updated_at?: string
          weekly_budget_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "time_categories_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_categories_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "time_categories_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "task_groups"
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
          status: string
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
          status: string
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
          status?: string
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
            foreignKeyName: "xero_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
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
    }
    Views: {
      live_actuals_by_period: {
        Row: {
          billable: boolean | null
          clickup_task_id: string | null
          client_id: string | null
          department_id: string | null
          entry_id: string | null
          entry_start: string | null
          hours: number | null
          team_member_id: string | null
          time_category_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ongoing_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ongoing_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_foundations_coverage"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "ongoing_tasks_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ongoing_tasks_time_category_id_fkey"
            columns: ["time_category_id"]
            isOneToOne: false
            referencedRelation: "time_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_primary_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      ongoing_actuals_current: {
        Row: {
          clickup_task_id: string | null
          cumulative_hours: number | null
          ongoing_task_id: string | null
          synced_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ongoing_actuals_ongoing_task_id_fkey"
            columns: ["ongoing_task_id"]
            isOneToOne: false
            referencedRelation: "ongoing_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      process_step_handoffs: {
        Row: {
          from_completed_at: string | null
          from_ordinal: number | null
          from_step_id: string | null
          from_title: string | null
          handoff_hours: number | null
          project_id: string | null
          to_started_at: string | null
          to_step_id: string | null
          to_title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "process_step_instances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
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
          task_name: string | null
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
      v_foundations_coverage: {
        Row: {
          baseline_label: string | null
          baseline_list_id: string | null
          clickup_folder_id: string | null
          clickup_list_id: string | null
          client_id: string | null
          client_name: string | null
          display_order: number | null
          group_id: string | null
          has_list: boolean | null
          short_name: string | null
          tasks_created: number | null
          tasks_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "baseline_lists_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "task_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sprint_actuals: {
        Row: {
          actual_id: string | null
          clickup_task_id: string | null
          project_id: string | null
          recorded_at: string | null
          sprint_points: number | null
          synced_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_actuals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_team_member_id: { Args: never; Returns: string }
      current_team_member_role: { Args: never; Returns: string }
      generate_project_code: { Args: never; Returns: string }
      get_direct_multiplier: {
        Args: { p_end: string; p_logged_by?: string; p_start: string }
        Returns: {
          ai_cost_zar: number
          ai_session_hours: number
          display_name: string
          human_hours: number
          logged_by: string
        }[]
      }
      normalise_git_remote: { Args: { remote: string }; Returns: string }
      queue_pending_client: {
        Args: { p_domain: string; p_sender: string; p_subject: string }
        Returns: {
          id: string
          seen_count: number
        }[]
      }
      queue_pending_sender: {
        Args: {
          p_client_id: string
          p_email: string
          p_sample_brief_id: string
          p_sample_subject: string
        }
        Returns: undefined
      }
      resolve_project_for_repo: {
        Args: { remote: string }
        Returns: {
          calculator_project_id: string
          clickup_list_id: string
          clickup_parent_task_id: string
          project_code: string
          project_name: string
        }[]
      }
      resolve_sow_clause: {
        Args: {
          p_clause_key: string
          p_client_id?: string
          p_project_id?: string
          p_service_id?: string
        }
        Returns: Json
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
        | "briefed"
      project_status: "in_progress" | "completed" | "cancelled" | "archived"
      quote_status: "draft" | "sent" | "accepted" | "rejected" | "superseded"
      recurrence_interval: "weekly" | "biweekly" | "monthly" | "quarterly"
      recurrence_mode: "none" | "project" | "per_service"
      sender_rule_mode: "allow" | "block"
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
        "briefed",
      ],
      project_status: ["in_progress", "completed", "cancelled", "archived"],
      quote_status: ["draft", "sent", "accepted", "rejected", "superseded"],
      recurrence_interval: ["weekly", "biweekly", "monthly", "quarterly"],
      recurrence_mode: ["none", "project", "per_service"],
      sender_rule_mode: ["allow", "block"],
    },
  },
} as const
