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
      adult_documents: {
        Row: {
          created_at: string
          document_date: string | null
          document_type: string | null
          file_path: string | null
          id: string
          notes: string | null
          patient_id: string
          professional_name: string | null
          professional_role: string | null
          psychologist_id: string
          title: string
        }
        Insert: {
          created_at?: string
          document_date?: string | null
          document_type?: string | null
          file_path?: string | null
          id?: string
          notes?: string | null
          patient_id: string
          professional_name?: string | null
          professional_role?: string | null
          psychologist_id: string
          title: string
        }
        Update: {
          created_at?: string
          document_date?: string | null
          document_type?: string | null
          file_path?: string | null
          id?: string
          notes?: string | null
          patient_id?: string
          professional_name?: string | null
          professional_role?: string | null
          psychologist_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "adult_documents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      allowed_therapists: {
        Row: {
          created_by: string | null
          email: string
          first_name: string | null
          id: string
          institution: string | null
          invited_at: string
          is_active: boolean
          joined_at: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          specialty: string | null
        }
        Insert: {
          created_by?: string | null
          email: string
          first_name?: string | null
          id?: string
          institution?: string | null
          invited_at?: string
          is_active?: boolean
          joined_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          specialty?: string | null
        }
        Update: {
          created_by?: string | null
          email?: string
          first_name?: string | null
          id?: string
          institution?: string | null
          invited_at?: string
          is_active?: boolean
          joined_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          specialty?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allowed_therapists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      child_documents: {
        Row: {
          child_patient_id: string
          created_at: string
          document_date: string | null
          document_type: string | null
          file_path: string | null
          id: string
          notes: string | null
          professional_name: string | null
          professional_role: string | null
          psychologist_id: string
          title: string
        }
        Insert: {
          child_patient_id: string
          created_at?: string
          document_date?: string | null
          document_type?: string | null
          file_path?: string | null
          id?: string
          notes?: string | null
          professional_name?: string | null
          professional_role?: string | null
          psychologist_id: string
          title: string
        }
        Update: {
          child_patient_id?: string
          created_at?: string
          document_date?: string | null
          document_type?: string | null
          file_path?: string | null
          id?: string
          notes?: string | null
          professional_name?: string | null
          professional_role?: string | null
          psychologist_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_documents_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
        ]
      }
      child_patient_medications: {
        Row: {
          child_patient_id: string
          created_at: string
          dose: string | null
          end_date: string | null
          frequency: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          prescribed_by: string | null
          psychologist_id: string
          start_date: string | null
        }
        Insert: {
          child_patient_id: string
          created_at?: string
          dose?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          prescribed_by?: string | null
          psychologist_id: string
          start_date?: string | null
        }
        Update: {
          child_patient_id?: string
          created_at?: string
          dose?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          prescribed_by?: string | null
          psychologist_id?: string
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_patient_medications_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_patient_medications_psychologist_id_fkey"
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
          extended_notes: string | null
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
          extended_notes?: string | null
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
          extended_notes?: string | null
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
      child_session_notes: {
        Row: {
          assigned_task: string | null
          child_patient_id: string
          created_at: string
          emotional_state: string | null
          id: string
          next_session_plan: string | null
          profile_update_suggestions: Json | null
          psychologist_id: string
          raw_notes: string
          refined_notes: string | null
          session_date: string
          session_number: number | null
          techniques_used: string | null
        }
        Insert: {
          assigned_task?: string | null
          child_patient_id: string
          created_at?: string
          emotional_state?: string | null
          id?: string
          next_session_plan?: string | null
          profile_update_suggestions?: Json | null
          psychologist_id: string
          raw_notes: string
          refined_notes?: string | null
          session_date: string
          session_number?: number | null
          techniques_used?: string | null
        }
        Update: {
          assigned_task?: string | null
          child_patient_id?: string
          created_at?: string
          emotional_state?: string | null
          id?: string
          next_session_plan?: string | null
          profile_update_suggestions?: Json | null
          psychologist_id?: string
          raw_notes?: string
          refined_notes?: string | null
          session_date?: string
          session_number?: number | null
          techniques_used?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_session_notes_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
        ]
      }
      child_tests: {
        Row: {
          child_patient_id: string
          created_at: string
          evaluation_date: string
          generated_report: string | null
          id: string
          notes: string | null
          psychologist_id: string
          report_pdf_path: string | null
          results_raw: string | null
          results_structured: Json | null
          test_name: string
          test_type: string | null
        }
        Insert: {
          child_patient_id: string
          created_at?: string
          evaluation_date: string
          generated_report?: string | null
          id?: string
          notes?: string | null
          psychologist_id: string
          report_pdf_path?: string | null
          results_raw?: string | null
          results_structured?: Json | null
          test_name: string
          test_type?: string | null
        }
        Update: {
          child_patient_id?: string
          created_at?: string
          evaluation_date?: string
          generated_report?: string | null
          id?: string
          notes?: string | null
          psychologist_id?: string
          report_pdf_path?: string | null
          results_raw?: string | null
          results_structured?: Json | null
          test_name?: string
          test_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_tests_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
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
          is_general_knowledge: boolean
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
          is_general_knowledge?: boolean
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
          is_general_knowledge?: boolean
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
          clinical_areas: string[]
          content: string
          created_at: string
          document_id: string
          document_type: string | null
          embedding: string | null
          id: string
          is_global: boolean
          language: string | null
          page_number: number | null
          psychologist_id: string
          source_institution: string | null
          source_institution_type: string | null
        }
        Insert: {
          chunk_index: number
          clinical_areas?: string[]
          content: string
          created_at?: string
          document_id: string
          document_type?: string | null
          embedding?: string | null
          id?: string
          is_global?: boolean
          language?: string | null
          page_number?: number | null
          psychologist_id: string
          source_institution?: string | null
          source_institution_type?: string | null
        }
        Update: {
          chunk_index?: number
          clinical_areas?: string[]
          content?: string
          created_at?: string
          document_id?: string
          document_type?: string | null
          embedding?: string | null
          id?: string
          is_global?: boolean
          language?: string | null
          page_number?: number | null
          psychologist_id?: string
          source_institution?: string | null
          source_institution_type?: string | null
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
          abstract: string | null
          author: string | null
          clinical_areas: string[]
          created_at: string
          document_type: string
          europepmc_id: string | null
          europepmc_source: string | null
          id: string
          import_source: string | null
          is_global: boolean
          language: string | null
          pmc_id: string | null
          processing_mode: string | null
          psychologist_id: string
          publication_date: string | null
          pubmed_id: string | null
          source_institution: string | null
          source_institution_type: string | null
          source_url: string | null
          storage_path: string | null
          title: string
          year: string | null
        }
        Insert: {
          abstract?: string | null
          author?: string | null
          clinical_areas?: string[]
          created_at?: string
          document_type: string
          europepmc_id?: string | null
          europepmc_source?: string | null
          id?: string
          import_source?: string | null
          is_global?: boolean
          language?: string | null
          pmc_id?: string | null
          processing_mode?: string | null
          psychologist_id: string
          publication_date?: string | null
          pubmed_id?: string | null
          source_institution?: string | null
          source_institution_type?: string | null
          source_url?: string | null
          storage_path?: string | null
          title: string
          year?: string | null
        }
        Update: {
          abstract?: string | null
          author?: string | null
          clinical_areas?: string[]
          created_at?: string
          document_type?: string
          europepmc_id?: string | null
          europepmc_source?: string | null
          id?: string
          import_source?: string | null
          is_global?: boolean
          language?: string | null
          pmc_id?: string | null
          processing_mode?: string | null
          psychologist_id?: string
          publication_date?: string | null
          pubmed_id?: string | null
          source_institution?: string | null
          source_institution_type?: string | null
          source_url?: string | null
          storage_path?: string | null
          title?: string
          year?: string | null
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string
          description: string
          id: string
          psychologist_id: string
          status: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          psychologist_id: string
          status?: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          psychologist_id?: string
          status?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      general_chat_memory: {
        Row: {
          created_at: string
          id: string
          key_facts: Json
          memory_summary: string | null
          preferences: Json
          psychologist_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_facts?: Json
          memory_summary?: string | null
          preferences?: Json
          psychologist_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key_facts?: Json
          memory_summary?: string | null
          preferences?: Json
          psychologist_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_chat_memory_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      general_conversations: {
        Row: {
          created_at: string
          id: string
          psychologist_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          psychologist_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          psychologist_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_conversations_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      general_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "general_conversations"
            referencedColumns: ["id"]
          },
        ]
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
      patient_medications: {
        Row: {
          created_at: string
          dose: string | null
          end_date: string | null
          frequency: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          patient_id: string
          prescribed_by: string | null
          psychologist_id: string
          start_date: string | null
        }
        Insert: {
          created_at?: string
          dose?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          patient_id: string
          prescribed_by?: string | null
          psychologist_id: string
          start_date?: string | null
        }
        Update: {
          created_at?: string
          dose?: string | null
          end_date?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          patient_id?: string
          prescribed_by?: string | null
          psychologist_id?: string
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_medications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_medications_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_profile_chat: {
        Row: {
          content: string
          created_at: string
          id: string
          patient_id: string
          psychologist_id: string
          role: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          patient_id: string
          psychologist_id: string
          role: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          patient_id?: string
          psychologist_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_profile_chat_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_transfers: {
        Row: {
          from_psychologist_id: string | null
          id: string
          new_patient_id: string | null
          notes: string | null
          patient_id: string | null
          snapshot: Json | null
          to_psychologist_id: string | null
          transferred_at: string
        }
        Insert: {
          from_psychologist_id?: string | null
          id?: string
          new_patient_id?: string | null
          notes?: string | null
          patient_id?: string | null
          snapshot?: Json | null
          to_psychologist_id?: string | null
          transferred_at?: string
        }
        Update: {
          from_psychologist_id?: string | null
          id?: string
          new_patient_id?: string | null
          notes?: string | null
          patient_id?: string | null
          snapshot?: Json | null
          to_psychologist_id?: string | null
          transferred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_transfers_from_psychologist_id_fkey"
            columns: ["from_psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_transfers_new_patient_id_fkey"
            columns: ["new_patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_transfers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_transfers_to_psychologist_id_fkey"
            columns: ["to_psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          birth_date: string | null
          clinical_history: string | null
          created_at: string
          diagnosis: string | null
          extended_notes: string | null
          family_context: string | null
          first_name: string
          id: string
          last_name: string
          marital_status: string | null
          notes: string | null
          occupation: string | null
          personal_resources: string | null
          presenting_problem: string | null
          previous_treatments: string | null
          profile_builder_completed: boolean
          psychologist_id: string
          relevant_history: string | null
          session_day: string | null
          session_duration: number | null
          session_frequency: string | null
          session_time: string | null
          sex: string | null
          start_date: string | null
          therapeutic_goals: string | null
          work_context: string | null
        }
        Insert: {
          birth_date?: string | null
          clinical_history?: string | null
          created_at?: string
          diagnosis?: string | null
          extended_notes?: string | null
          family_context?: string | null
          first_name: string
          id?: string
          last_name: string
          marital_status?: string | null
          notes?: string | null
          occupation?: string | null
          personal_resources?: string | null
          presenting_problem?: string | null
          previous_treatments?: string | null
          profile_builder_completed?: boolean
          psychologist_id: string
          relevant_history?: string | null
          session_day?: string | null
          session_duration?: number | null
          session_frequency?: string | null
          session_time?: string | null
          sex?: string | null
          start_date?: string | null
          therapeutic_goals?: string | null
          work_context?: string | null
        }
        Update: {
          birth_date?: string | null
          clinical_history?: string | null
          created_at?: string
          diagnosis?: string | null
          extended_notes?: string | null
          family_context?: string | null
          first_name?: string
          id?: string
          last_name?: string
          marital_status?: string | null
          notes?: string | null
          occupation?: string | null
          personal_resources?: string | null
          presenting_problem?: string | null
          previous_treatments?: string | null
          profile_builder_completed?: boolean
          psychologist_id?: string
          relevant_history?: string | null
          session_day?: string | null
          session_duration?: number | null
          session_frequency?: string | null
          session_time?: string | null
          sex?: string | null
          start_date?: string | null
          therapeutic_goals?: string | null
          work_context?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          created_at: string
          default_session_duration: number | null
          default_session_frequency: string | null
          first_name: string
          google_calendar_id: string | null
          google_calendar_token: Json | null
          graduation_year: number | null
          id: string
          institution: string | null
          is_admin: boolean
          last_name: string
          license_number: string | null
          linkedin: string | null
          phone: string | null
          postgraduate: string | null
          region: string | null
          rut: string | null
          secondary_specialty: string | null
          specialty: string | null
          theoretical_approach: string[] | null
          university: string | null
          website: string | null
          years_experience: number | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          default_session_duration?: number | null
          default_session_frequency?: string | null
          first_name: string
          google_calendar_id?: string | null
          google_calendar_token?: Json | null
          graduation_year?: number | null
          id: string
          institution?: string | null
          is_admin?: boolean
          last_name: string
          license_number?: string | null
          linkedin?: string | null
          phone?: string | null
          postgraduate?: string | null
          region?: string | null
          rut?: string | null
          secondary_specialty?: string | null
          specialty?: string | null
          theoretical_approach?: string[] | null
          university?: string | null
          website?: string | null
          years_experience?: number | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          default_session_duration?: number | null
          default_session_frequency?: string | null
          first_name?: string
          google_calendar_id?: string | null
          google_calendar_token?: Json | null
          graduation_year?: number | null
          id?: string
          institution?: string | null
          is_admin?: boolean
          last_name?: string
          license_number?: string | null
          linkedin?: string | null
          phone?: string | null
          postgraduate?: string | null
          region?: string | null
          rut?: string | null
          secondary_specialty?: string | null
          specialty?: string | null
          theoretical_approach?: string[] | null
          university?: string | null
          website?: string | null
          years_experience?: number | null
        }
        Relationships: []
      }
      response_feedback: {
        Row: {
          answer: string
          comment: string | null
          consultation_id: string | null
          created_at: string
          id: string
          psychologist_id: string
          question: string
          rating: string
        }
        Insert: {
          answer: string
          comment?: string | null
          consultation_id?: string | null
          created_at?: string
          id?: string
          psychologist_id: string
          question: string
          rating: string
        }
        Update: {
          answer?: string
          comment?: string | null
          consultation_id?: string | null
          created_at?: string
          id?: string
          psychologist_id?: string
          question?: string
          rating?: string
        }
        Relationships: [
          {
            foreignKeyName: "response_feedback_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_feedback_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          assigned_task: string | null
          child_patient_id: string | null
          claude_suggestions_used: Json
          clinical_feedback: string | null
          completed_at: string | null
          created_at: string
          duration_minutes: number | null
          emotional_state: string | null
          google_event_id: string | null
          id: string
          interventions_used: string | null
          live_transcript: Json
          next_session_plan: string | null
          patient_id: string | null
          patient_interventions: Json
          post_session_notes: string | null
          pre_session_notes: string | null
          pre_session_suggestions: string | null
          profile_update_suggestions: Json | null
          psychologist_id: string
          session_date: string
          session_mode_status: string | null
          session_number: number | null
          session_summary: string | null
          session_time: string | null
          started_at: string | null
          status: string | null
          therapist_audio_path: string | null
          therapist_notes_live: Json
          therapist_text_complement: string | null
          what_happened: string | null
        }
        Insert: {
          assigned_task?: string | null
          child_patient_id?: string | null
          claude_suggestions_used?: Json
          clinical_feedback?: string | null
          completed_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          emotional_state?: string | null
          google_event_id?: string | null
          id?: string
          interventions_used?: string | null
          live_transcript?: Json
          next_session_plan?: string | null
          patient_id?: string | null
          patient_interventions?: Json
          post_session_notes?: string | null
          pre_session_notes?: string | null
          pre_session_suggestions?: string | null
          profile_update_suggestions?: Json | null
          psychologist_id: string
          session_date: string
          session_mode_status?: string | null
          session_number?: number | null
          session_summary?: string | null
          session_time?: string | null
          started_at?: string | null
          status?: string | null
          therapist_audio_path?: string | null
          therapist_notes_live?: Json
          therapist_text_complement?: string | null
          what_happened?: string | null
        }
        Update: {
          assigned_task?: string | null
          child_patient_id?: string | null
          claude_suggestions_used?: Json
          clinical_feedback?: string | null
          completed_at?: string | null
          created_at?: string
          duration_minutes?: number | null
          emotional_state?: string | null
          google_event_id?: string | null
          id?: string
          interventions_used?: string | null
          live_transcript?: Json
          next_session_plan?: string | null
          patient_id?: string | null
          patient_interventions?: Json
          post_session_notes?: string | null
          pre_session_notes?: string | null
          pre_session_suggestions?: string | null
          profile_update_suggestions?: Json | null
          psychologist_id?: string
          session_date?: string
          session_mode_status?: string | null
          session_number?: number | null
          session_summary?: string | null
          session_time?: string | null
          started_at?: string | null
          status?: string | null
          therapist_audio_path?: string | null
          therapist_notes_live?: Json
          therapist_text_complement?: string | null
          what_happened?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_child_patient_id_fkey"
            columns: ["child_patient_id"]
            isOneToOne: false
            referencedRelation: "child_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_psychologist_id_fkey"
            columns: ["psychologist_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_team: {
        Row: {
          address: string | null
          child_patient_id: string | null
          created_at: string
          email: string | null
          id: string
          institution: string | null
          is_primary_contact: boolean
          notes: string | null
          patient_id: string | null
          phone: string | null
          professional_name: string
          professional_role: string
          psychologist_id: string
          specialty: string | null
        }
        Insert: {
          address?: string | null
          child_patient_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          institution?: string | null
          is_primary_contact?: boolean
          notes?: string | null
          patient_id?: string | null
          phone?: string | null
          professional_name: string
          professional_role: string
          psychologist_id: string
          specialty?: string | null
        }
        Update: {
          address?: string | null
          child_patient_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          institution?: string | null
          is_primary_contact?: boolean
          notes?: string | null
          patient_id?: string | null
          phone?: string | null
          professional_name?: string
          professional_role?: string
          psychologist_id?: string
          specialty?: string | null
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
      admin_document_chunk_counts: {
        Args: never
        Returns: {
          chunk_count: number
          document_id: string
        }[]
      }
      admin_list_therapist_child_patients: {
        Args: { _therapist_id: string }
        Returns: {
          birth_date: string
          diagnosis: string
          first_name: string
          guardian_name: string
          id: string
          last_name: string
        }[]
      }
      admin_list_therapist_patients: {
        Args: { _therapist_id: string }
        Returns: {
          birth_date: string
          diagnosis: string
          first_name: string
          id: string
          last_name: string
          start_date: string
        }[]
      }
      admin_list_therapists: {
        Args: never
        Returns: {
          created_at: string
          email: string
          first_name: string
          id: string
          is_admin: boolean
          last_name: string
          patient_count: number
          phone: string
          rut: string
        }[]
      }
      admin_transfer_child_patient: {
        Args: {
          _child_patient_id: string
          _to_therapist_id: string
          _transfer_notes?: string
        }
        Returns: string
      }
      admin_transfer_patient: {
        Args: {
          _patient_id: string
          _to_therapist_id: string
          _transfer_notes?: string
        }
        Returns: string
      }
      get_user_id_by_email: { Args: { _email: string }; Returns: string }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_email_allowed: { Args: { _email: string }; Returns: boolean }
      match_chunks: {
        Args: {
          match_count?: number
          p_clinical_area?: string
          p_clinical_areas?: string[]
          p_document_type?: string
          p_psychologist_id?: string
          p_source_institution?: string
          p_source_institutions?: string[]
          p_year_from?: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          clinical_areas: string[]
          content: string
          document_id: string
          document_type: string
          id: string
          is_global: boolean
          page_number: number
          similarity: number
          source_institution: string
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
