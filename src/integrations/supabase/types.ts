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
      behavioral_tracking: {
        Row: {
          behavior_name: string
          child_patient_id: string
          created_at: string
          id: string
          notes: string | null
          psychologist_id: string
          score: number | null
          tracking_date: string
        }
        Insert: {
          behavior_name: string
          child_patient_id: string
          created_at?: string
          id?: string
          notes?: string | null
          psychologist_id: string
          score?: number | null
          tracking_date: string
        }
        Update: {
          behavior_name?: string
          child_patient_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          psychologist_id?: string
          score?: number | null
          tracking_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "behavioral_tracking_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavioral_tracking_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      child_patients: {
        Row: {
          birth_date: string
          created_at: string
          current_medication: string | null
          first_name: string
          grade: string | null
          homeroom_teacher: string | null
          id: string
          last_name: string
          medical_diagnosis: string | null
          modality: string | null
          notes: string | null
          psychologist_id: string
          referral_reason: string | null
          referral_source: string | null
          school: string | null
          sex: string | null
          specialist_name: string | null
        }
        Insert: {
          birth_date: string
          created_at?: string
          current_medication?: string | null
          first_name: string
          grade?: string | null
          homeroom_teacher?: string | null
          id?: string
          last_name: string
          medical_diagnosis?: string | null
          modality?: string | null
          notes?: string | null
          psychologist_id: string
          referral_reason?: string | null
          referral_source?: string | null
          school?: string | null
          sex?: string | null
          specialist_name?: string | null
        }
        Update: {
          birth_date?: string
          created_at?: string
          current_medication?: string | null
          first_name?: string
          grade?: string | null
          homeroom_teacher?: string | null
          id?: string
          last_name?: string
          medical_diagnosis?: string | null
          modality?: string | null
          notes?: string | null
          psychologist_id?: string
          referral_reason?: string | null
          referral_source?: string | null
          school?: string | null
          sex?: string | null
          specialist_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_patients_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_log: {
        Row: {
          agreements: string | null
          child_patient_id: string
          contact_date: string
          contact_type: string | null
          contact_with: string | null
          created_at: string
          id: string
          psychologist_id: string
          summary: string
        }
        Insert: {
          agreements?: string | null
          child_patient_id: string
          contact_date: string
          contact_type?: string | null
          contact_with?: string | null
          created_at?: string
          id?: string
          psychologist_id: string
          summary: string
        }
        Update: {
          agreements?: string | null
          child_patient_id?: string
          contact_date?: string
          contact_type?: string | null
          contact_with?: string | null
          created_at?: string
          id?: string
          psychologist_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_log_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_log_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consultations: {
        Row: {
          answer: string
          citations: Json
          conversation_id: string | null
          conversation_title: string | null
          created_at: string
          document_type_filter: string | null
          id: string
          patient_id: string | null
          psychologist_id: string
          question: string
        }
        Insert: {
          answer: string
          citations?: Json
          conversation_id?: string | null
          conversation_title?: string | null
          created_at?: string
          document_type_filter?: string | null
          id?: string
          patient_id?: string | null
          psychologist_id: string
          question: string
        }
        Update: {
          answer?: string
          citations?: Json
          conversation_id?: string | null
          conversation_title?: string | null
          created_at?: string
          document_type_filter?: string | null
          id?: string
          patient_id?: string | null
          psychologist_id?: string
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          page_number: number | null
          psychologist_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          page_number?: number | null
          psychologist_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          page_number?: number | null
          psychologist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          author: string | null
          created_at: string
          document_type: string
          id: string
          is_global: boolean
          psychologist_id: string
          storage_path: string | null
          title: string
          year: string | null
        }
        Insert: {
          author?: string | null
          created_at?: string
          document_type: string
          id?: string
          is_global?: boolean
          psychologist_id: string
          storage_path?: string | null
          title: string
          year?: string | null
        }
        Update: {
          author?: string | null
          created_at?: string
          document_type?: string
          id?: string
          is_global?: boolean
          psychologist_id?: string
          storage_path?: string | null
          title?: string
          year?: string | null
        }
        Relationships: []
      }
      goal_tasks: {
        Row: {
          assigned_date: string | null
          child_patient_id: string
          created_at: string
          description: string | null
          goal_id: string
          id: string
          psychologist_id: string
          responsible: string | null
          session_date: string | null
          status: string | null
          title: string
        }
        Insert: {
          assigned_date?: string | null
          child_patient_id: string
          created_at?: string
          description?: string | null
          goal_id: string
          id?: string
          psychologist_id: string
          responsible?: string | null
          session_date?: string | null
          status?: string | null
          title: string
        }
        Update: {
          assigned_date?: string | null
          child_patient_id?: string
          created_at?: string
          description?: string | null
          goal_id?: string
          id?: string
          psychologist_id?: string
          responsible?: string | null
          session_date?: string | null
          status?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_tasks_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_tasks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "intervention_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_tasks_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guardians: {
        Row: {
          child_patient_id: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          involvement_level: string | null
          phone: string | null
          psychologist_id: string
          relationship: string | null
        }
        Insert: {
          child_patient_id: string
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          involvement_level?: string | null
          phone?: string | null
          psychologist_id: string
          relationship?: string | null
        }
        Update: {
          child_patient_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          involvement_level?: string | null
          phone?: string | null
          psychologist_id?: string
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guardians_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardians_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_goals: {
        Row: {
          achieved_date: string | null
          child_patient_id: string
          created_at: string
          description: string | null
          estimated_date: string | null
          id: string
          psychologist_id: string
          status: string | null
          title: string
        }
        Insert: {
          achieved_date?: string | null
          child_patient_id: string
          created_at?: string
          description?: string | null
          estimated_date?: string | null
          id?: string
          psychologist_id: string
          status?: string | null
          title: string
        }
        Update: {
          achieved_date?: string | null
          child_patient_id?: string
          created_at?: string
          description?: string | null
          estimated_date?: string | null
          id?: string
          psychologist_id?: string
          status?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "intervention_goals_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_goals_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      other_evaluations: {
        Row: {
          child_patient_id: string
          created_at: string
          evaluation_date: string
          id: string
          observations: string | null
          psychologist_id: string
          report_path: string | null
          results: string | null
          test_name: string
        }
        Insert: {
          child_patient_id: string
          created_at?: string
          evaluation_date: string
          id?: string
          observations?: string | null
          psychologist_id: string
          report_path?: string | null
          results?: string | null
          test_name: string
        }
        Update: {
          child_patient_id?: string
          created_at?: string
          evaluation_date?: string
          id?: string
          observations?: string | null
          psychologist_id?: string
          report_path?: string | null
          results?: string | null
          test_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "other_evaluations_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "other_evaluations_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          birth_date: string | null
          created_at: string
          diagnosis: string | null
          first_name: string
          id: string
          last_name: string
          marital_status: string | null
          notes: string | null
          occupation: string | null
          psychologist_id: string
          sex: string | null
          start_date: string | null
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          diagnosis?: string | null
          first_name: string
          id?: string
          last_name: string
          marital_status?: string | null
          notes?: string | null
          occupation?: string | null
          psychologist_id: string
          sex?: string | null
          start_date?: string | null
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          diagnosis?: string | null
          first_name?: string
          id?: string
          last_name?: string
          marital_status?: string | null
          notes?: string | null
          occupation?: string | null
          psychologist_id?: string
          sex?: string | null
          start_date?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          first_name: string
          id: string
          is_admin: boolean
          last_name: string
          phone: string | null
          rut: string | null
        }
        Insert: {
          created_at?: string
          first_name: string
          id: string
          is_admin?: boolean
          last_name: string
          phone?: string | null
          rut?: string | null
        }
        Update: {
          created_at?: string
          first_name?: string
          id?: string
          is_admin?: boolean
          last_name?: string
          phone?: string | null
          rut?: string | null
        }
        Relationships: []
      }
      wisc_evaluations: {
        Row: {
          child_patient_id: string
          cit: number | null
          created_at: string
          evaluation_date: string
          icv: number | null
          id: string
          imt: number | null
          irf: number | null
          irp: number | null
          ivp: number | null
          observations: string | null
          psychologist_id: string
          report_path: string | null
          version: string | null
        }
        Insert: {
          child_patient_id: string
          cit?: number | null
          created_at?: string
          evaluation_date: string
          icv?: number | null
          id?: string
          imt?: number | null
          irf?: number | null
          irp?: number | null
          ivp?: number | null
          observations?: string | null
          psychologist_id: string
          report_path?: string | null
          version?: string | null
        }
        Update: {
          child_patient_id?: string
          cit?: number | null
          created_at?: string
          evaluation_date?: string
          icv?: number | null
          id?: string
          imt?: number | null
          irf?: number | null
          irp?: number | null
          ivp?: number | null
          observations?: string | null
          psychologist_id?: string
          report_path?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wisc_evaluations_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wisc_evaluations_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      match_chunks: {
        Args: {
          match_count?: number
          p_document_type?: string
          p_psychologist_id?: string
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          document_id: string
          id: string
          page_number: number
          similarity: number
        }[]
      }
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
