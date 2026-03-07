export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: string
          global_inbound_address: string | null
          global_inbound_token: string | null
          installation_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          global_inbound_address?: string | null
          global_inbound_token?: string | null
          installation_id?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          global_inbound_address?: string | null
          global_inbound_token?: string | null
          installation_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      funds: {
        Row: {
          id: string
          name: string
          email_domain: string | null
          logo_url: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          email_domain?: string | null
          logo_url?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          email_domain?: string | null
          logo_url?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'funds_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      fund_members: {
        Row: {
          id: string
          fund_id: string
          user_id: string
          role: string
          display_name: string | null
          invited_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          user_id: string
          role?: string
          display_name?: string | null
          invited_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          user_id?: string
          role?: string
          display_name?: string | null
          invited_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fund_members_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fund_members_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fund_members_invited_by_fkey'
            columns: ['invited_by']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      fund_settings: {
        Row: {
          id: string
          fund_id: string
          claude_api_key_encrypted: string | null
          encryption_key_encrypted: string | null
          postmark_inbound_address: string | null
          postmark_webhook_token: string | null
          postmark_webhook_token_encrypted: string | null
          retain_resolved_reviews: boolean
          resolved_reviews_ttl_days: number | null
          google_refresh_token_encrypted: string | null
          google_drive_folder_id: string | null
          google_drive_folder_name: string | null
          google_client_id: string | null
          google_client_secret_encrypted: string | null
          claude_model: string
          ai_summary_prompt: string | null
          outbound_email_provider: string | null
          asks_email_provider: string | null
          approval_email_subject: string | null
          approval_email_body: string | null
          system_email_from_name: string | null
          system_email_from_address: string | null
          resend_api_key_encrypted: string | null
          postmark_server_token_encrypted: string | null
          inbound_email_provider: string | null
          mailgun_inbound_domain: string | null
          mailgun_signing_key_encrypted: string | null
          mailgun_api_key_encrypted: string | null
          mailgun_sending_domain: string | null
          file_storage_provider: string | null
          dropbox_app_key: string | null
          dropbox_app_secret_encrypted: string | null
          dropbox_refresh_token_encrypted: string | null
          dropbox_folder_path: string | null
          openai_api_key_encrypted: string | null
          openai_model: string
          default_ai_provider: string
          gemini_api_key_encrypted: string | null
          gemini_model: string
          ollama_base_url: string | null
          ollama_model: string
          analytics_fathom_site_id: string | null
          analytics_ga_measurement_id: string | null
          analytics_custom_head_script: string | null
          disable_user_tracking: boolean
          currency: string
          feature_visibility: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          claude_api_key_encrypted?: string | null
          encryption_key_encrypted?: string | null
          postmark_inbound_address?: string | null
          postmark_webhook_token?: string | null
          postmark_webhook_token_encrypted?: string | null
          retain_resolved_reviews?: boolean
          resolved_reviews_ttl_days?: number | null
          google_refresh_token_encrypted?: string | null
          google_drive_folder_id?: string | null
          google_drive_folder_name?: string | null
          claude_model?: string
          ai_summary_prompt?: string | null
          outbound_email_provider?: string | null
          asks_email_provider?: string | null
          approval_email_subject?: string | null
          approval_email_body?: string | null
          system_email_from_name?: string | null
          system_email_from_address?: string | null
          resend_api_key_encrypted?: string | null
          postmark_server_token_encrypted?: string | null
          inbound_email_provider?: string | null
          mailgun_inbound_domain?: string | null
          mailgun_signing_key_encrypted?: string | null
          mailgun_api_key_encrypted?: string | null
          mailgun_sending_domain?: string | null
          file_storage_provider?: string | null
          dropbox_app_key?: string | null
          dropbox_app_secret_encrypted?: string | null
          dropbox_refresh_token_encrypted?: string | null
          dropbox_folder_path?: string | null
          openai_api_key_encrypted?: string | null
          openai_model?: string
          default_ai_provider?: string
          gemini_api_key_encrypted?: string | null
          gemini_model?: string
          ollama_base_url?: string | null
          ollama_model?: string
          analytics_fathom_site_id?: string | null
          analytics_ga_measurement_id?: string | null
          analytics_custom_head_script?: string | null
          disable_user_tracking?: boolean
          currency?: string
          feature_visibility?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          claude_api_key_encrypted?: string | null
          encryption_key_encrypted?: string | null
          postmark_inbound_address?: string | null
          postmark_webhook_token?: string | null
          postmark_webhook_token_encrypted?: string | null
          retain_resolved_reviews?: boolean
          resolved_reviews_ttl_days?: number | null
          google_refresh_token_encrypted?: string | null
          google_drive_folder_id?: string | null
          google_drive_folder_name?: string | null
          claude_model?: string
          ai_summary_prompt?: string | null
          outbound_email_provider?: string | null
          asks_email_provider?: string | null
          approval_email_subject?: string | null
          approval_email_body?: string | null
          system_email_from_name?: string | null
          system_email_from_address?: string | null
          resend_api_key_encrypted?: string | null
          postmark_server_token_encrypted?: string | null
          inbound_email_provider?: string | null
          mailgun_inbound_domain?: string | null
          mailgun_signing_key_encrypted?: string | null
          mailgun_api_key_encrypted?: string | null
          mailgun_sending_domain?: string | null
          file_storage_provider?: string | null
          dropbox_app_key?: string | null
          dropbox_app_secret_encrypted?: string | null
          dropbox_refresh_token_encrypted?: string | null
          dropbox_folder_path?: string | null
          openai_api_key_encrypted?: string | null
          openai_model?: string
          default_ai_provider?: string
          gemini_api_key_encrypted?: string | null
          gemini_model?: string
          ollama_base_url?: string | null
          ollama_model?: string
          analytics_fathom_site_id?: string | null
          analytics_ga_measurement_id?: string | null
          analytics_custom_head_script?: string | null
          disable_user_tracking?: boolean
          currency?: string
          feature_visibility?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fund_settings_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
        ]
      }
      authorized_senders: {
        Row: {
          id: string
          fund_id: string
          email: string
          label: string | null
          created_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          email: string
          label?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          email?: string
          label?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'authorized_senders_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
        ]
      }
      companies: {
        Row: {
          id: string
          fund_id: string
          name: string
          aliases: string[] | null
          industry: string[] | null
          stage: string | null
          founded_year: number | null
          notes: string | null
          tags: string[]
          status: 'active' | 'exited' | 'written-off'
          overview: string | null
          founders: string | null
          why_invested: string | null
          current_update: string | null
          contact_email: string[] | null
          portfolio_group: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          name: string
          aliases?: string[] | null
          industry?: string[] | null
          stage?: string | null
          founded_year?: number | null
          notes?: string | null
          tags?: string[]
          status?: 'active' | 'exited' | 'written-off'
          overview?: string | null
          founders?: string | null
          why_invested?: string | null
          current_update?: string | null
          contact_email?: string[] | null
          portfolio_group?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          name?: string
          aliases?: string[] | null
          industry?: string[] | null
          stage?: string | null
          founded_year?: number | null
          notes?: string | null
          tags?: string[]
          status?: 'active' | 'exited' | 'written-off'
          overview?: string | null
          founders?: string | null
          why_invested?: string | null
          current_update?: string | null
          contact_email?: string[] | null
          portfolio_group?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'companies_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
        ]
      }
      inbound_emails: {
        Row: {
          id: string
          fund_id: string
          company_id: string | null
          from_address: string
          subject: string | null
          received_at: string
          raw_payload: Json | null
          processing_status: 'pending' | 'processing' | 'success' | 'failed' | 'needs_review' | 'not_processed'
          processing_error: string | null
          claude_response: Json | null
          metrics_extracted: number
          attachments_count: number
          email_type: string
          created_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          company_id?: string | null
          from_address: string
          subject?: string | null
          received_at?: string
          raw_payload?: Json | null
          processing_status?: 'pending' | 'processing' | 'success' | 'failed' | 'needs_review' | 'not_processed'
          processing_error?: string | null
          claude_response?: Json | null
          metrics_extracted?: number
          attachments_count?: number
          email_type?: string
          created_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          company_id?: string | null
          from_address?: string
          subject?: string | null
          received_at?: string
          raw_payload?: Json | null
          processing_status?: 'pending' | 'processing' | 'success' | 'failed' | 'needs_review' | 'not_processed'
          processing_error?: string | null
          claude_response?: Json | null
          metrics_extracted?: number
          attachments_count?: number
          email_type?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'inbound_emails_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inbound_emails_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
        ]
      }
      metrics: {
        Row: {
          id: string
          company_id: string
          fund_id: string
          name: string
          slug: string
          description: string | null
          unit: string | null
          unit_position: 'prefix' | 'suffix'
          value_type: 'number' | 'currency' | 'percentage' | 'text'
          reporting_cadence: 'quarterly' | 'monthly' | 'annual'
          display_order: number
          is_active: boolean
          currency: string | null
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          fund_id: string
          name: string
          slug: string
          description?: string | null
          unit?: string | null
          unit_position?: 'prefix' | 'suffix'
          value_type?: 'number' | 'currency' | 'percentage' | 'text'
          reporting_cadence?: 'quarterly' | 'monthly' | 'annual'
          display_order?: number
          is_active?: boolean
          currency?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          fund_id?: string
          name?: string
          slug?: string
          description?: string | null
          unit?: string | null
          unit_position?: 'prefix' | 'suffix'
          value_type?: 'number' | 'currency' | 'percentage' | 'text'
          reporting_cadence?: 'quarterly' | 'monthly' | 'annual'
          display_order?: number
          is_active?: boolean
          currency?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'metrics_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'metrics_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
        ]
      }
      metric_values: {
        Row: {
          id: string
          metric_id: string
          company_id: string
          fund_id: string
          period_label: string
          period_year: number
          period_quarter: number | null
          period_month: number | null
          value_number: number | null
          value_text: string | null
          confidence: 'high' | 'medium' | 'low'
          source_email_id: string | null
          notes: string | null
          is_manually_entered: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          metric_id: string
          company_id: string
          fund_id: string
          period_label: string
          period_year: number
          period_quarter?: number | null
          period_month?: number | null
          value_number?: number | null
          value_text?: string | null
          confidence?: 'high' | 'medium' | 'low'
          source_email_id?: string | null
          notes?: string | null
          is_manually_entered?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          metric_id?: string
          company_id?: string
          fund_id?: string
          period_label?: string
          period_year?: number
          period_quarter?: number | null
          period_month?: number | null
          value_number?: number | null
          value_text?: string | null
          confidence?: 'high' | 'medium' | 'low'
          source_email_id?: string | null
          notes?: string | null
          is_manually_entered?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'metric_values_metric_id_fkey'
            columns: ['metric_id']
            referencedRelation: 'metrics'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'metric_values_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'metric_values_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'metric_values_source_email_id_fkey'
            columns: ['source_email_id']
            referencedRelation: 'inbound_emails'
            referencedColumns: ['id']
          },
        ]
      }
      company_summaries: {
        Row: {
          id: string
          company_id: string
          fund_id: string
          period_label: string | null
          summary_text: string
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          fund_id: string
          period_label?: string | null
          summary_text: string
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          fund_id?: string
          period_label?: string | null
          summary_text?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'company_summaries_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'company_summaries_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
        ]
      }
      parsing_reviews: {
        Row: {
          id: string
          fund_id: string
          email_id: string
          metric_id: string | null
          company_id: string | null
          issue_type:
            | 'new_company_detected'
            | 'low_confidence'
            | 'ambiguous_period'
            | 'metric_not_found'
            | 'company_not_identified'
            | 'duplicate_period'
          extracted_value: string | null
          context_snippet: string | null
          resolution: 'accepted' | 'rejected' | 'manually_corrected' | null
          resolved_value: string | null
          resolved_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          email_id: string
          metric_id?: string | null
          company_id?: string | null
          issue_type:
            | 'new_company_detected'
            | 'low_confidence'
            | 'ambiguous_period'
            | 'metric_not_found'
            | 'company_not_identified'
            | 'duplicate_period'
          extracted_value?: string | null
          context_snippet?: string | null
          resolution?: 'accepted' | 'rejected' | 'manually_corrected' | null
          resolved_value?: string | null
          resolved_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          email_id?: string
          metric_id?: string | null
          company_id?: string | null
          issue_type?:
            | 'new_company_detected'
            | 'low_confidence'
            | 'ambiguous_period'
            | 'metric_not_found'
            | 'company_not_identified'
            | 'duplicate_period'
          extracted_value?: string | null
          context_snippet?: string | null
          resolution?: 'accepted' | 'rejected' | 'manually_corrected' | null
          resolved_value?: string | null
          resolved_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'parsing_reviews_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'parsing_reviews_email_id_fkey'
            columns: ['email_id']
            referencedRelation: 'inbound_emails'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'parsing_reviews_metric_id_fkey'
            columns: ['metric_id']
            referencedRelation: 'metrics'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'parsing_reviews_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
        ]
      }
      allowed_signups: {
        Row: {
          id: string
          email_pattern: string
          created_at: string
        }
        Insert: {
          id?: string
          email_pattern: string
          created_at?: string
        }
        Update: {
          id?: string
          email_pattern?: string
          created_at?: string
        }
        Relationships: []
      }
      fund_join_requests: {
        Row: {
          id: string
          fund_id: string
          user_id: string
          email: string
          status: string
          reviewed_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          user_id: string
          email: string
          status?: string
          reviewed_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          user_id?: string
          email?: string
          status?: string
          reviewed_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fund_join_requests_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fund_join_requests_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fund_join_requests_reviewed_by_fkey'
            columns: ['reviewed_by']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      email_requests: {
        Row: {
          id: string
          fund_id: string
          subject: string
          body_html: string
          recipients: Json
          sent_by: string
          quarter_label: string | null
          status: string
          sent_at: string | null
          send_results: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          subject: string
          body_html: string
          recipients?: Json
          sent_by: string
          quarter_label?: string | null
          status?: string
          sent_at?: string | null
          send_results?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          subject?: string
          body_html?: string
          recipients?: Json
          sent_by?: string
          quarter_label?: string | null
          status?: string
          sent_at?: string | null
          send_results?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_requests_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_requests_sent_by_fkey'
            columns: ['sent_by']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      company_notes: {
        Row: {
          id: string
          company_id: string
          fund_id: string
          user_id: string
          content: string
          mentioned_user_ids: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          fund_id: string
          user_id: string
          content: string
          mentioned_user_ids?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          fund_id?: string
          user_id?: string
          content?: string
          mentioned_user_ids?: string[]
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'company_notes_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'company_notes_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'company_notes_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      investment_transactions: {
        Row: {
          id: string
          company_id: string
          fund_id: string
          transaction_type: 'investment' | 'proceeds' | 'unrealized_gain_change' | 'round_info'
          round_name: string | null
          transaction_date: string | null
          notes: string | null
          investment_cost: number | null
          interest_converted: number | null
          shares_acquired: number | null
          share_price: number | null
          cost_basis_exited: number | null
          proceeds_received: number | null
          proceeds_escrow: number | null
          proceeds_written_off: number | null
          proceeds_per_share: number | null
          unrealized_value_change: number | null
          current_share_price: number | null
          postmoney_valuation: number | null
          latest_postmoney_valuation: number | null
          exit_valuation: number | null
          original_currency: string | null
          original_investment_cost: number | null
          original_share_price: number | null
          original_postmoney_valuation: number | null
          original_proceeds_received: number | null
          original_proceeds_per_share: number | null
          original_exit_valuation: number | null
          original_unrealized_value_change: number | null
          original_current_share_price: number | null
          original_latest_postmoney_valuation: number | null
          ownership_pct: number | null
          portfolio_group: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          fund_id: string
          transaction_type: 'investment' | 'proceeds' | 'unrealized_gain_change' | 'round_info'
          round_name?: string | null
          transaction_date?: string | null
          notes?: string | null
          investment_cost?: number | null
          interest_converted?: number | null
          shares_acquired?: number | null
          share_price?: number | null
          cost_basis_exited?: number | null
          proceeds_received?: number | null
          proceeds_escrow?: number | null
          proceeds_written_off?: number | null
          proceeds_per_share?: number | null
          unrealized_value_change?: number | null
          current_share_price?: number | null
          postmoney_valuation?: number | null
          latest_postmoney_valuation?: number | null
          exit_valuation?: number | null
          original_currency?: string | null
          original_investment_cost?: number | null
          original_share_price?: number | null
          original_postmoney_valuation?: number | null
          original_proceeds_received?: number | null
          original_proceeds_per_share?: number | null
          original_exit_valuation?: number | null
          original_unrealized_value_change?: number | null
          original_current_share_price?: number | null
          original_latest_postmoney_valuation?: number | null
          ownership_pct?: number | null
          portfolio_group?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          fund_id?: string
          transaction_type?: 'investment' | 'proceeds' | 'unrealized_gain_change' | 'round_info'
          round_name?: string | null
          transaction_date?: string | null
          notes?: string | null
          investment_cost?: number | null
          interest_converted?: number | null
          shares_acquired?: number | null
          share_price?: number | null
          cost_basis_exited?: number | null
          proceeds_received?: number | null
          proceeds_escrow?: number | null
          proceeds_written_off?: number | null
          proceeds_per_share?: number | null
          unrealized_value_change?: number | null
          current_share_price?: number | null
          postmoney_valuation?: number | null
          latest_postmoney_valuation?: number | null
          exit_valuation?: number | null
          original_currency?: string | null
          original_investment_cost?: number | null
          original_share_price?: number | null
          original_postmoney_valuation?: number | null
          original_proceeds_received?: number | null
          original_proceeds_per_share?: number | null
          original_exit_valuation?: number | null
          original_unrealized_value_change?: number | null
          original_current_share_price?: number | null
          original_latest_postmoney_valuation?: number | null
          ownership_pct?: number | null
          portfolio_group?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'investment_transactions_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'investment_transactions_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
        ]
      }
      note_reads: {
        Row: {
          user_id: string
          note_id: string
          read_at: string
        }
        Insert: {
          user_id: string
          note_id: string
          read_at?: string
        }
        Update: {
          user_id?: string
          note_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'note_reads_note_id_fkey'
            columns: ['note_id']
            referencedRelation: 'company_notes'
            referencedColumns: ['id']
          },
        ]
      }
      note_notification_preferences: {
        Row: {
          id: string
          user_id: string
          fund_id: string
          level: 'all' | 'mentions' | 'none'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          fund_id: string
          level?: 'all' | 'mentions' | 'none'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          fund_id?: string
          level?: 'all' | 'mentions' | 'none'
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'note_notification_preferences_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
        ]
      }
      note_company_subscriptions: {
        Row: {
          id: string
          user_id: string
          company_id: string
          fund_id: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          company_id: string
          fund_id: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          company_id?: string
          fund_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'note_company_subscriptions_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'note_company_subscriptions_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
        ]
      }
      interactions: {
        Row: {
          id: string
          fund_id: string
          company_id: string | null
          email_id: string | null
          user_id: string
          tags: string[]
          subject: string | null
          summary: string | null
          intro_contacts: Json
          body_preview: string | null
          interaction_date: string
          created_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          company_id?: string | null
          email_id?: string | null
          user_id: string
          tags?: string[]
          subject?: string | null
          summary?: string | null
          intro_contacts?: Json
          body_preview?: string | null
          interaction_date?: string
          created_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          company_id?: string | null
          email_id?: string | null
          user_id?: string
          tags?: string[]
          subject?: string | null
          summary?: string | null
          intro_contacts?: Json
          body_preview?: string | null
          interaction_date?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'interactions_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'interactions_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'interactions_email_id_fkey'
            columns: ['email_id']
            referencedRelation: 'inbound_emails'
            referencedColumns: ['id']
          },
        ]
      }
      analyst_conversations: {
        Row: {
          id: string
          fund_id: string
          user_id: string
          company_id: string | null
          title: string
          messages: Json
          summary: string | null
          message_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          user_id: string
          company_id?: string | null
          title?: string
          messages?: Json
          summary?: string | null
          message_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          user_id?: string
          company_id?: string | null
          title?: string
          messages?: Json
          summary?: string | null
          message_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'analyst_conversations_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'analyst_conversations_company_id_fkey'
            columns: ['company_id']
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
        ]
      }
      lp_letter_templates: {
        Row: {
          id: string
          fund_id: string
          name: string
          style_guide: string | null
          source_filename: string | null
          source_type: 'upload' | 'google_doc' | 'default' | null
          source_format: 'docx' | 'pdf' | 'google_doc' | null
          source_text: string | null
          is_default: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          name?: string
          style_guide?: string | null
          source_filename?: string | null
          source_type?: 'upload' | 'google_doc' | 'default' | null
          source_format?: 'docx' | 'pdf' | 'google_doc' | null
          source_text?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          name?: string
          style_guide?: string | null
          source_filename?: string | null
          source_type?: 'upload' | 'google_doc' | 'default' | null
          source_format?: 'docx' | 'pdf' | 'google_doc' | null
          source_text?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lp_letter_templates_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
        ]
      }
      lp_letters: {
        Row: {
          id: string
          fund_id: string
          template_id: string | null
          period_year: number
          period_quarter: number
          is_year_end: boolean
          period_label: string
          portfolio_group: string
          portfolio_table_html: string | null
          company_narratives: Json
          full_draft: string | null
          generation_prompt: string | null
          generation_error: string | null
          portfolio_summary: Json | null
          company_prompts: Record<string, { prompt: string; mode: 'add' | 'replace' }> | null
          status: 'generating' | 'draft' | 'final'
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          fund_id: string
          template_id?: string | null
          period_year: number
          period_quarter: number
          is_year_end?: boolean
          period_label: string
          portfolio_group: string
          portfolio_table_html?: string | null
          company_narratives?: CompanyNarrative[]
          full_draft?: string | null
          generation_prompt?: string | null
          generation_error?: string | null
          portfolio_summary?: Json | null
          company_prompts?: Record<string, { prompt: string; mode: 'add' | 'replace' }> | null
          status?: 'generating' | 'draft' | 'final'
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          fund_id?: string
          template_id?: string | null
          period_year?: number
          period_quarter?: number
          is_year_end?: boolean
          period_label?: string
          portfolio_group?: string
          portfolio_table_html?: string | null
          company_narratives?: CompanyNarrative[]
          full_draft?: string | null
          generation_prompt?: string | null
          generation_error?: string | null
          portfolio_summary?: Json | null
          company_prompts?: Record<string, { prompt: string; mode: 'add' | 'replace' }> | null
          status?: 'generating' | 'draft' | 'final'
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lp_letters_fund_id_fkey'
            columns: ['fund_id']
            referencedRelation: 'funds'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lp_letters_template_id_fkey'
            columns: ['template_id']
            referencedRelation: 'lp_letter_templates'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      get_my_fund_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      count_unread_notes: {
        Args: { p_user_id: string }
        Returns: number
      }
      is_fund_member_by_email: {
        Args: { p_fund_id: string; p_email: string }
        Returns: { user_id: string; member_role: string }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

// Convenience helpers matching Supabase's generated type conventions
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

// Row-level type aliases
export type AppSettings    = Tables<'app_settings'>
export type Fund           = Tables<'funds'>
export type FundMember     = Tables<'fund_members'>
export type FundSettings   = Tables<'fund_settings'>
export type AuthorizedSender = Tables<'authorized_senders'>
export type Company        = Tables<'companies'>
export type InboundEmail   = Tables<'inbound_emails'>
export type Metric         = Tables<'metrics'>
export type MetricValue    = Tables<'metric_values'>
export type CompanySummary = Tables<'company_summaries'>
export type ParsingReview  = Tables<'parsing_reviews'>
export type AllowedSignup  = Tables<'allowed_signups'>
export type FundJoinRequest = Tables<'fund_join_requests'>
export type EmailRequest    = Tables<'email_requests'>
export type CompanyNote     = Tables<'company_notes'>
export type InvestmentTransaction = Tables<'investment_transactions'>
export type NoteRead             = Tables<'note_reads'>
export type NoteNotificationPreference = Tables<'note_notification_preferences'>
export type NoteCompanySubscription    = Tables<'note_company_subscriptions'>
export type AnalystConversation        = Tables<'analyst_conversations'>
export type Interaction                = Tables<'interactions'>
export type LpLetterTemplate           = Tables<'lp_letter_templates'>
export type LpLetter                   = Tables<'lp_letters'>

export interface CompanyNarrative {
  company_id: string
  company_name: string
  narrative: string
  updated_by: string | null
  updated_at: string
}

export type LpLetterStatus = 'generating' | 'draft' | 'final'

// Enum-style string literals
export type CompanyStatus      = 'active' | 'exited' | 'written-off'
export type ProcessingStatus   = 'pending' | 'processing' | 'success' | 'failed' | 'needs_review' | 'not_processed'
export type Confidence         = 'high' | 'medium' | 'low'
export type ValueType          = 'number' | 'currency' | 'percentage' | 'text'
export type UnitPosition       = 'prefix' | 'suffix'
export type ReportingCadence   = 'quarterly' | 'monthly' | 'annual'
export type IssueType          =
  | 'new_company_detected'
  | 'low_confidence'
  | 'ambiguous_period'
  | 'metric_not_found'
  | 'company_not_identified'
  | 'duplicate_period'
export type ReviewResolution   = 'accepted' | 'rejected' | 'manually_corrected'
export type EmailRequestStatus = 'draft' | 'sent' | 'failed'
export type TransactionType    = 'investment' | 'proceeds' | 'unrealized_gain_change' | 'round_info'
export type NotificationLevel  = 'all' | 'mentions' | 'none'
