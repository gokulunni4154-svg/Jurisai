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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_legal_insights: {
        Row: {
          completed_at: string | null
          created_at: string
          document_analysis_id: string
          error_message: string | null
          id: string
          provider_used: Database["public"]["Enums"]["ai_provider_name"] | null
          result: Json | null
          status: Database["public"]["Enums"]["ai_legal_insight_status"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["ai_legal_insight_status"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id?: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["ai_legal_insight_status"]
        }
        Relationships: [
          {
            foreignKeyName: "ai_legal_insights_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          completed_at: string | null
          created_at: string
          document_analysis_id: string
          error_message: string | null
          id: string
          provider_used: Database["public"]["Enums"]["ai_provider_name"] | null
          result: Json | null
          status: Database["public"]["Enums"]["ai_recommendation_status"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["ai_recommendation_status"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id?: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["ai_recommendation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          document_analysis_id: string
          id: string
          last_message_at: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_analysis_id: string
          id?: string
          last_message_at?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_analysis_id?: string
          id?: string
          last_message_at?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          provider_used: string | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          provider_used?: string | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          provider_used?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      clause_classifications: {
        Row: {
          completed_at: string | null
          created_at: string
          document_analysis_id: string
          error_message: string | null
          id: string
          provider_used: Database["public"]["Enums"]["ai_provider_name"] | null
          result: Json | null
          status: Database["public"]["Enums"]["clause_classification_status"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["clause_classification_status"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id?: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["clause_classification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "clause_classifications_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_detections: {
        Row: {
          completed_at: string | null
          created_at: string
          document_analysis_id: string
          error_message: string | null
          id: string
          provider_used: Database["public"]["Enums"]["ai_provider_name"] | null
          result: Json | null
          status: Database["public"]["Enums"]["compliance_detection_status"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["compliance_detection_status"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id?: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["compliance_detection_status"]
        }
        Relationships: [
          {
            foreignKeyName: "compliance_detections_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      document_analyses: {
        Row: {
          completed_at: string | null
          created_at: string
          document_id: string
          error_message: string | null
          id: string
          provider_used: Database["public"]["Enums"]["ai_provider_name"] | null
          result: Json | null
          status: Database["public"]["Enums"]["document_analysis_status"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          document_id: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["document_analysis_status"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          document_id?: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["document_analysis_status"]
        }
        Relationships: [
          {
            foreignKeyName: "document_analyses_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          mime_type: string
          owner_id: string
          size_bytes: number
          storage_path: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          mime_type: string
          owner_id: string
          size_bytes: number
          storage_path: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          mime_type?: string
          owner_id?: string
          size_bytes?: number
          storage_path?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      legal_health_scores: {
        Row: {
          category_scores: Json | null
          completed_at: string | null
          created_at: string
          document_analysis_id: string
          error_message: string | null
          id: string
          overall_score: number | null
          provider_used: Database["public"]["Enums"]["ai_provider_name"] | null
          result: Json | null
          status: Database["public"]["Enums"]["legal_health_score_status"]
        }
        Insert: {
          category_scores?: Json | null
          completed_at?: string | null
          created_at?: string
          document_analysis_id: string
          error_message?: string | null
          id?: string
          overall_score?: number | null
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["legal_health_score_status"]
        }
        Update: {
          category_scores?: Json | null
          completed_at?: string | null
          created_at?: string
          document_analysis_id?: string
          error_message?: string | null
          id?: string
          overall_score?: number | null
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["legal_health_score_status"]
        }
        Relationships: [
          {
            foreignKeyName: "legal_health_scores_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      missing_clause_detections: {
        Row: {
          completed_at: string | null
          created_at: string
          document_analysis_id: string
          error_message: string | null
          id: string
          provider_used: Database["public"]["Enums"]["ai_provider_name"] | null
          result: Json | null
          status: Database["public"]["Enums"]["missing_clause_detection_status"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["missing_clause_detection_status"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id?: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["missing_clause_detection_status"]
        }
        Relationships: [
          {
            foreignKeyName: "missing_clause_detections_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_extractions: {
        Row: {
          created_at: string
          document_id: string
          error_message: string | null
          id: string
          provider: string | null
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id: string
          error_message?: string | null
          id?: string
          provider?: string | null
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          error_message?: string | null
          id?: string
          provider?: string | null
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocr_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      risk_detections: {
        Row: {
          completed_at: string | null
          created_at: string
          document_analysis_id: string
          error_message: string | null
          id: string
          provider_used: Database["public"]["Enums"]["ai_provider_name"] | null
          result: Json | null
          status: Database["public"]["Enums"]["risk_detection_status"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["risk_detection_status"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          document_analysis_id?: string
          error_message?: string | null
          id?: string
          provider_used?: Database["public"]["Enums"]["ai_provider_name"] | null
          result?: Json | null
          status?: Database["public"]["Enums"]["risk_detection_status"]
        }
        Relationships: [
          {
            foreignKeyName: "risk_detections_document_analysis_id_fkey"
            columns: ["document_analysis_id"]
            isOneToOne: false
            referencedRelation: "document_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      ai_legal_insight_status: "pending" | "processing" | "completed" | "failed"
      ai_provider_name: "openai" | "gemini"
      ai_recommendation_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
      clause_classification_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
      compliance_detection_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
      document_analysis_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
      legal_health_score_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
      missing_clause_detection_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
      risk_detection_status: "pending" | "processing" | "completed" | "failed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_legal_insight_status: ["pending", "processing", "completed", "failed"],
      ai_provider_name: ["openai", "gemini"],
      ai_recommendation_status: [
        "pending",
        "processing",
        "completed",
        "failed",
      ],
      clause_classification_status: [
        "pending",
        "processing",
        "completed",
        "failed",
      ],
      compliance_detection_status: [
        "pending",
        "processing",
        "completed",
        "failed",
      ],
      document_analysis_status: [
        "pending",
        "processing",
        "completed",
        "failed",
      ],
      legal_health_score_status: [
        "pending",
        "processing",
        "completed",
        "failed",
      ],
      missing_clause_detection_status: [
        "pending",
        "processing",
        "completed",
        "failed",
      ],
      risk_detection_status: ["pending", "processing", "completed", "failed"],
    },
  },
} as const
