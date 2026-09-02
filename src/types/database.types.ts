export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      answers: {
        Row: {
          created_at: string;
          id: string;
          question_id: string;
          submission_id: string;
          value_bool: boolean | null;
          value_json: Json | null;
          value_number: number | null;
          value_text: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          question_id: string;
          submission_id: string;
          value_bool?: boolean | null;
          value_json?: Json | null;
          value_number?: number | null;
          value_text?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          question_id?: string;
          submission_id?: string;
          value_bool?: boolean | null;
          value_json?: Json | null;
          value_number?: number | null;
          value_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'answers_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'answers_submission_id_fkey';
            columns: ['submission_id'];
            isOneToOne: false;
            referencedRelation: 'submissions';
            referencedColumns: ['id'];
          },
        ];
      };
      assignments: {
        Row: {
          created_at: string;
          ends_on: string;
          id: string;
          starts_on: string;
          tour_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          ends_on: string;
          id?: string;
          starts_on: string;
          tour_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string;
          id?: string;
          starts_on?: string;
          tour_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'assignments_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      attachments: {
        Row: {
          attempts: number;
          bytes: number;
          created_at: string;
          drive_file_id: string | null;
          drive_url: string | null;
          filename: string;
          id: string;
          invoice_id: string | null;
          mime: string;
          question_id: string | null;
          storage_path: string;
          submission_id: string | null;
          sync_error: string | null;
          sync_status: Database['public']['Enums']['sync_status'];
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          bytes?: number;
          created_at?: string;
          drive_file_id?: string | null;
          drive_url?: string | null;
          filename: string;
          id?: string;
          invoice_id?: string | null;
          mime: string;
          question_id?: string | null;
          storage_path: string;
          submission_id?: string | null;
          sync_error?: string | null;
          sync_status?: Database['public']['Enums']['sync_status'];
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          bytes?: number;
          created_at?: string;
          drive_file_id?: string | null;
          drive_url?: string | null;
          filename?: string;
          id?: string;
          invoice_id?: string | null;
          mime?: string;
          question_id?: string | null;
          storage_path?: string;
          submission_id?: string | null;
          sync_error?: string | null;
          sync_status?: Database['public']['Enums']['sync_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'attachments_invoice_id_fkey';
            columns: ['invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoices';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attachments_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attachments_submission_id_fkey';
            columns: ['submission_id'];
            isOneToOne: false;
            referencedRelation: 'submissions';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          entity: string;
          entity_id: string | null;
          id: number;
          meta: Json | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          entity: string;
          entity_id?: string | null;
          id?: never;
          meta?: Json | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          entity?: string;
          entity_id?: string | null;
          id?: never;
          meta?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      drive_folders: {
        Row: {
          created_at: string;
          folder_id: string;
          group_id: string | null;
          id: string;
          kind: string;
          name: string;
          parent_id: string | null;
          report_date: string | null;
          root_folder_id: string;
          tour_id: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          folder_id: string;
          group_id?: string | null;
          id?: string;
          kind: string;
          name: string;
          parent_id?: string | null;
          report_date?: string | null;
          root_folder_id: string;
          tour_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          folder_id?: string;
          group_id?: string | null;
          id?: string;
          kind?: string;
          name?: string;
          parent_id?: string | null;
          report_date?: string | null;
          root_folder_id?: string;
          tour_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'drive_folders_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'drive_folders_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'drive_folders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'drive_folders_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'drive_folders_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      forms: {
        Row: {
          created_at: string;
          group_id: string | null;
          id: string;
          is_mandatory: boolean;
          is_published: boolean;
          kind: Database['public']['Enums']['form_kind'];
          title_en: string;
          title_lt: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          group_id?: string | null;
          id?: string;
          is_mandatory?: boolean;
          is_published?: boolean;
          kind: Database['public']['Enums']['form_kind'];
          title_en: string;
          title_lt: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          group_id?: string | null;
          id?: string;
          is_mandatory?: boolean;
          is_published?: boolean;
          kind?: Database['public']['Enums']['form_kind'];
          title_en?: string;
          title_lt?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'forms_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      groups: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          is_active: boolean;
          key: string;
          lead_user_id: string | null;
          name_en: string;
          name_lt: string;
          notify_at: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key: string;
          lead_user_id?: string | null;
          name_en: string;
          name_lt: string;
          notify_at: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          key?: string;
          lead_user_id?: string | null;
          name_en?: string;
          name_lt?: string;
          notify_at?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'groups_lead_user_id_fkey';
            columns: ['lead_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      invites: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          token_hash: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          token_hash: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          token_hash?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invites_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'invites_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      invoices: {
        Row: {
          amount: number;
          category: string;
          created_at: string;
          currency: string;
          description: string;
          id: string;
          review_note: string | null;
          reviewed_by: string | null;
          spent_on: string;
          status: Database['public']['Enums']['invoice_status'];
          tour_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          category: string;
          created_at?: string;
          currency?: string;
          description: string;
          id?: string;
          review_note?: string | null;
          reviewed_by?: string | null;
          spent_on: string;
          status?: Database['public']['Enums']['invoice_status'];
          tour_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          category?: string;
          created_at?: string;
          currency?: string;
          description?: string;
          id?: string;
          review_note?: string | null;
          reviewed_by?: string | null;
          spent_on?: string;
          status?: Database['public']['Enums']['invoice_status'];
          tour_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'invoices_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      issues: {
        Row: {
          assigned_to: string | null;
          closed_at: string | null;
          created_at: string;
          id: string;
          note: string | null;
          question_key: string;
          status: Database['public']['Enums']['issue_status'];
          submission_id: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          closed_at?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          question_key: string;
          status?: Database['public']['Enums']['issue_status'];
          submission_id: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          closed_at?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          question_key?: string;
          status?: Database['public']['Enums']['issue_status'];
          submission_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'issues_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'issues_submission_id_fkey';
            columns: ['submission_id'];
            isOneToOne: false;
            referencedRelation: 'submissions';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          created_at: string;
          error: string | null;
          id: string;
          kind: Database['public']['Enums']['notification_kind'];
          report_date: string | null;
          scheduled_for: string;
          sent_at: string | null;
          status: Database['public']['Enums']['notification_status'];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          id?: string;
          kind: Database['public']['Enums']['notification_kind'];
          report_date?: string | null;
          scheduled_for: string;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          user_id: string;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['notification_kind'];
          report_date?: string | null;
          scheduled_for?: string;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          first_name: string;
          full_name: string | null;
          group_id: string | null;
          is_admin: boolean;
          last_name: string;
          locale: string;
          location_consent_at: string | null;
          must_change_password: boolean;
          notify_at: string | null;
          phone: string | null;
          push_token: string | null;
          status: Database['public']['Enums']['profile_status'];
          timezone: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          first_name: string;
          full_name?: string | null;
          group_id?: string | null;
          is_admin?: boolean;
          last_name: string;
          locale?: string;
          location_consent_at?: string | null;
          must_change_password?: boolean;
          notify_at?: string | null;
          phone?: string | null;
          push_token?: string | null;
          status?: Database['public']['Enums']['profile_status'];
          timezone?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          first_name?: string;
          full_name?: string | null;
          group_id?: string | null;
          is_admin?: boolean;
          last_name?: string;
          locale?: string;
          location_consent_at?: string | null;
          must_change_password?: boolean;
          notify_at?: string | null;
          phone?: string | null;
          push_token?: string | null;
          status?: Database['public']['Enums']['profile_status'];
          timezone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      questions: {
        Row: {
          created_at: string;
          form_id: string;
          help_text: string | null;
          id: string;
          is_required: boolean;
          key: string;
          label_en: string;
          label_lt: string;
          opens_issue: boolean;
          options: Json | null;
          order_index: number;
          type: Database['public']['Enums']['question_type'];
          validation: Json | null;
          visible_if: Json | null;
        };
        Insert: {
          created_at?: string;
          form_id: string;
          help_text?: string | null;
          id?: string;
          is_required?: boolean;
          key: string;
          label_en: string;
          label_lt: string;
          opens_issue?: boolean;
          options?: Json | null;
          order_index: number;
          type: Database['public']['Enums']['question_type'];
          validation?: Json | null;
          visible_if?: Json | null;
        };
        Update: {
          created_at?: string;
          form_id?: string;
          help_text?: string | null;
          id?: string;
          is_required?: boolean;
          key?: string;
          label_en?: string;
          label_lt?: string;
          opens_issue?: boolean;
          options?: Json | null;
          order_index?: number;
          type?: Database['public']['Enums']['question_type'];
          validation?: Json | null;
          visible_if?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'questions_form_id_fkey';
            columns: ['form_id'];
            isOneToOne: false;
            referencedRelation: 'forms';
            referencedColumns: ['id'];
          },
        ];
      };
      shows: {
        Row: {
          city: string;
          created_at: string;
          date: string;
          id: string;
          sequence: number;
          show_at: string | null;
          tour_id: string;
          updated_at: string;
          venue: string | null;
        };
        Insert: {
          city: string;
          created_at?: string;
          date: string;
          id?: string;
          sequence?: number;
          show_at?: string | null;
          tour_id: string;
          updated_at?: string;
          venue?: string | null;
        };
        Update: {
          city?: string;
          created_at?: string;
          date?: string;
          id?: string;
          sequence?: number;
          show_at?: string | null;
          tour_id?: string;
          updated_at?: string;
          venue?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shows_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
        ];
      };
      submissions: {
        Row: {
          accuracy_m: number | null;
          created_at: string;
          edited_at: string | null;
          form_id: string;
          id: string;
          is_late: boolean;
          lat: number | null;
          lng: number | null;
          location_shared: boolean;
          report_date: string;
          status: Database['public']['Enums']['submission_status'];
          submitted_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          accuracy_m?: number | null;
          created_at?: string;
          edited_at?: string | null;
          form_id: string;
          id?: string;
          is_late?: boolean;
          lat?: number | null;
          lng?: number | null;
          location_shared?: boolean;
          report_date: string;
          status?: Database['public']['Enums']['submission_status'];
          submitted_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          accuracy_m?: number | null;
          created_at?: string;
          edited_at?: string | null;
          form_id?: string;
          id?: string;
          is_late?: boolean;
          lat?: number | null;
          lng?: number | null;
          location_shared?: boolean;
          report_date?: string;
          status?: Database['public']['Enums']['submission_status'];
          submitted_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'submissions_form_id_fkey';
            columns: ['form_id'];
            isOneToOne: false;
            referencedRelation: 'forms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'submissions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      tours: {
        Row: {
          code: string;
          created_at: string;
          currency: string;
          ends_on: string;
          id: string;
          is_active: boolean;
          name: string;
          starts_on: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          currency?: string;
          ends_on: string;
          id?: string;
          is_active?: boolean;
          name: string;
          starts_on: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          currency?: string;
          ends_on?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          starts_on?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      compliance_summary: {
        Args: { p_from: string; p_to: string; p_user_id: string };
        Returns: Json;
      };
      consume_invite: { Args: { p_token: string }; Returns: string };
      edit_deadline: {
        Args: { p_report_date: string; p_timezone: string };
        Returns: string;
      };
      invoice_editable: { Args: { p_invoice_id: string }; Returns: boolean };
      is_admin: { Args: never; Returns: boolean };
      is_lead_of: { Args: { p_user_id: string }; Returns: boolean };
      is_service_role: { Args: never; Returns: boolean };
      local_today: { Args: { p_timezone: string }; Returns: string };
      mint_invite: {
        Args: { p_ttl?: string; p_user_id: string };
        Returns: string;
      };
      my_group_id: { Args: never; Returns: string };
      my_timezone: { Args: never; Returns: string };
      report_calendar: {
        Args: { p_from: string; p_to: string; p_user_id: string };
        Returns: {
          expected: boolean;
          is_late: boolean;
          report_date: string;
          status: string;
          submission_id: string;
        }[];
      };
      submission_editable: {
        Args: { p_submission_id: string };
        Returns: boolean;
      };
      submit_report: {
        Args: {
          p_answers: Json;
          p_form_id: string;
          p_location?: Json;
          p_report_date: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      form_kind: 'daily' | 'weekly';
      invoice_status: 'submitted' | 'approved' | 'rejected';
      issue_status: 'open' | 'closed';
      notification_kind: 'daily' | 'daily_followup' | 'weekly' | 'broadcast';
      notification_status: 'scheduled' | 'sent' | 'failed' | 'skipped';
      profile_status: 'invited' | 'active' | 'inactive';
      question_type:
        | 'yes_no'
        | 'rating'
        | 'number'
        | 'money'
        | 'short_text'
        | 'long_text'
        | 'single_choice'
        | 'photo'
        | 'file'
        | 'date'
        | 'tour_select';
      submission_status: 'submitted' | 'excused';
      sync_status: 'pending' | 'syncing' | 'synced' | 'failed';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      form_kind: ['daily', 'weekly'],
      invoice_status: ['submitted', 'approved', 'rejected'],
      issue_status: ['open', 'closed'],
      notification_kind: ['daily', 'daily_followup', 'weekly', 'broadcast'],
      notification_status: ['scheduled', 'sent', 'failed', 'skipped'],
      profile_status: ['invited', 'active', 'inactive'],
      question_type: [
        'yes_no',
        'rating',
        'number',
        'money',
        'short_text',
        'long_text',
        'single_choice',
        'photo',
        'file',
        'date',
        'tour_select',
      ],
      submission_status: ['submitted', 'excused'],
      sync_status: ['pending', 'syncing', 'synced', 'failed'],
    },
  },
} as const;
