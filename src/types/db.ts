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
      service_allocation_overrides: {
        Row: {
          department_id: string
          pct: number
          service_id: string
        }
        Insert: {
          department_id: string
          pct: number
          service_id: string
        }
        Update: {
          department_id?: string
          pct?: number
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_allocation_overrides_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_allocation_overrides_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "service_totals"
            referencedColumns: ["service_id"]
          },
          {
            foreignKeyName: "service_allocation_overrides_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
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
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

