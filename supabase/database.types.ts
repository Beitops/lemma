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
      activity_events: {
        Row: {
          actor_agent_name: string | null
          actor_type: string
          actor_user_id: string | null
          created_at: string
          details: Json
          entity_id: string
          entity_revision: number | null
          entity_type: string
          event_type: string
          id: string
          objective_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_agent_name?: string | null
          actor_type: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          entity_id: string
          entity_revision?: number | null
          entity_type: string
          event_type: string
          id?: string
          objective_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_agent_name?: string | null
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string
          entity_revision?: number | null
          entity_type?: string
          event_type?: string
          id?: string
          objective_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_objective_workspace_fkey"
            columns: ["objective_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "objectives"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "activity_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      assumptions: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          created_at: string
          id: string
          label: string
          revision: number
          statement_markdown: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          id?: string
          label: string
          revision?: number
          statement_markdown: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          id?: string
          label?: string
          revision?: number
          statement_markdown?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assumptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          created_at: string
          forked_from_step_id: string | null
          id: string
          name: string
          parent_branch_id: string | null
          revision: number
          status: string
          strategy_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          forked_from_step_id?: string | null
          id?: string
          name: string
          parent_branch_id?: string | null
          revision?: number
          status?: string
          strategy_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          forked_from_step_id?: string | null
          id?: string
          name?: string
          parent_branch_id?: string | null
          revision?: number
          status?: string
          strategy_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_fork_step_parent_fkey"
            columns: ["forked_from_step_id", "parent_branch_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id", "branch_id"]
          },
          {
            foreignKeyName: "branches_parent_branch_id_strategy_id_workspace_id_fkey"
            columns: ["parent_branch_id", "strategy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "strategy_id", "workspace_id"]
          },
          {
            foreignKeyName: "branches_strategy_id_workspace_id_fkey"
            columns: ["strategy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      clean_solution_snapshots: {
        Row: {
          body_markdown: string
          branch_id: string
          created_at: string
          created_by_agent_name: string | null
          created_by_type: string
          created_by_user_id: string | null
          id: string
          source_branch_revision: number
          strategy_id: string
          workspace_id: string
        }
        Insert: {
          body_markdown: string
          branch_id: string
          created_at?: string
          created_by_agent_name?: string | null
          created_by_type: string
          created_by_user_id?: string | null
          id?: string
          source_branch_revision: number
          strategy_id: string
          workspace_id: string
        }
        Update: {
          body_markdown?: string
          branch_id?: string
          created_at?: string
          created_by_agent_name?: string | null
          created_by_type?: string
          created_by_user_id?: string | null
          id?: string
          source_branch_revision?: number
          strategy_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clean_solution_snapshots_branch_id_strategy_id_workspace_i_fkey"
            columns: ["branch_id", "strategy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "strategy_id", "workspace_id"]
          },
          {
            foreignKeyName: "clean_solution_snapshots_strategy_id_workspace_id_fkey"
            columns: ["strategy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      context_items: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          body_markdown: string | null
          created_at: string
          id: string
          kind: string
          metadata: Json
          mime_type: string | null
          objective_id: string | null
          processing_status: string
          revision: number
          size_bytes: number | null
          source_url: string | null
          storage_bucket: string | null
          storage_path: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          body_markdown?: string | null
          created_at?: string
          id?: string
          kind: string
          metadata?: Json
          mime_type?: string | null
          objective_id?: string | null
          processing_status?: string
          revision?: number
          size_bytes?: number | null
          source_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          body_markdown?: string | null
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          mime_type?: string | null
          objective_id?: string | null
          processing_status?: string
          revision?: number
          size_bytes?: number | null
          source_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_items_objective_workspace_fkey"
            columns: ["objective_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "objectives"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "context_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          kind: string
          objective_id: string | null
          question_markdown: string
          requested_by_agent_name: string | null
          requested_by_type: string
          requested_by_user_id: string | null
          resolution_markdown: string | null
          resolution_outcome: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          revision: number
          status: string
          step_id: string | null
          strategy_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          objective_id?: string | null
          question_markdown: string
          requested_by_agent_name?: string | null
          requested_by_type: string
          requested_by_user_id?: string | null
          resolution_markdown?: string | null
          resolution_outcome?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          revision?: number
          status?: string
          step_id?: string | null
          strategy_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          objective_id?: string | null
          question_markdown?: string
          requested_by_agent_name?: string | null
          requested_by_type?: string
          requested_by_user_id?: string | null
          resolution_markdown?: string | null
          resolution_outcome?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          revision?: number
          status?: string
          step_id?: string | null
          strategy_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_branch_id_workspace_id_fkey"
            columns: ["branch_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "decisions_objective_workspace_fkey"
            columns: ["objective_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "objectives"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "decisions_step_id_workspace_id_fkey"
            columns: ["step_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "decisions_strategy_id_workspace_id_fkey"
            columns: ["strategy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "decisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      objectives: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          constraints_markdown: string
          created_at: string
          id: string
          objective_markdown: string
          revision: number
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          constraints_markdown?: string
          created_at?: string
          id?: string
          objective_markdown: string
          revision?: number
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          constraints_markdown?: string
          created_at?: string
          id?: string
          objective_markdown?: string
          revision?: number
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "objectives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reasoning_results: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          branch_id: string | null
          created_at: string
          id: string
          objective_id: string
          outcome_status: string
          result_markdown: string
          revision: number
          strategy_id: string
          target_id: string | null
          target_revision: number
          target_type: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type: string
          author_user_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          objective_id: string
          outcome_status: string
          result_markdown: string
          revision?: number
          strategy_id: string
          target_id?: string | null
          target_revision: number
          target_type?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          objective_id?: string
          outcome_status?: string
          result_markdown?: string
          revision?: number
          strategy_id?: string
          target_id?: string | null
          target_revision?: number
          target_type?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reasoning_results_branch_id_strategy_id_workspace_id_fkey"
            columns: ["branch_id", "strategy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "strategy_id", "workspace_id"]
          },
          {
            foreignKeyName: "reasoning_results_objective_id_workspace_id_fkey"
            columns: ["objective_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "objectives"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "reasoning_results_strategy_id_objective_id_workspace_id_fkey"
            columns: ["strategy_id", "objective_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id", "objective_id", "workspace_id"]
          },
          {
            foreignKeyName: "reasoning_results_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          citation_text: string
          context_item_id: string | null
          created_at: string
          id: string
          kind: string
          metadata: Json
          revision: number
          source_url: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          citation_text?: string
          context_item_id?: string | null
          created_at?: string
          id?: string
          kind: string
          metadata?: Json
          revision?: number
          source_url?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          citation_text?: string
          context_item_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          revision?: number
          source_url?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sources_context_item_id_workspace_id_fkey"
            columns: ["context_item_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "context_items"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      step_assumptions: {
        Row: {
          assumption_id: string
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          created_at: string
          id: string
          note_markdown: string
          revision: number
          status: string
          step_id: string
          updated_at: string
          usage_kind: string
          workspace_id: string
        }
        Insert: {
          assumption_id: string
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          id?: string
          note_markdown?: string
          revision?: number
          status?: string
          step_id: string
          updated_at?: string
          usage_kind?: string
          workspace_id: string
        }
        Update: {
          assumption_id?: string
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          id?: string
          note_markdown?: string
          revision?: number
          status?: string
          step_id?: string
          updated_at?: string
          usage_kind?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_assumptions_assumption_id_workspace_id_fkey"
            columns: ["assumption_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "assumptions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "step_assumptions_step_id_workspace_id_fkey"
            columns: ["step_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "step_assumptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      step_dependencies: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          created_at: string
          depends_on_step_id: string
          id: string
          rationale_markdown: string
          relation_kind: string
          revision: number
          status: string
          step_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          depends_on_step_id: string
          id?: string
          rationale_markdown?: string
          relation_kind?: string
          revision?: number
          status?: string
          step_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          depends_on_step_id?: string
          id?: string
          rationale_markdown?: string
          relation_kind?: string
          revision?: number
          status?: string
          step_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_dependencies_depends_on_step_id_workspace_id_fkey"
            columns: ["depends_on_step_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "step_dependencies_step_id_workspace_id_fkey"
            columns: ["step_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "step_dependencies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      step_revisions: {
        Row: {
          body_markdown: string
          change_kind: string
          changed_by_agent_name: string | null
          changed_by_type: string
          changed_by_user_id: string | null
          concepts: string[]
          created_at: string
          id: string
          revision: number
          status: string
          step_id: string
          summary: string | null
          theorem_tags: string[]
          title: string
          workspace_id: string
        }
        Insert: {
          body_markdown: string
          change_kind: string
          changed_by_agent_name?: string | null
          changed_by_type: string
          changed_by_user_id?: string | null
          concepts: string[]
          created_at?: string
          id?: string
          revision: number
          status: string
          step_id: string
          summary?: string | null
          theorem_tags: string[]
          title: string
          workspace_id: string
        }
        Update: {
          body_markdown?: string
          change_kind?: string
          changed_by_agent_name?: string | null
          changed_by_type?: string
          changed_by_user_id?: string | null
          concepts?: string[]
          created_at?: string
          id?: string
          revision?: number
          status?: string
          step_id?: string
          summary?: string | null
          theorem_tags?: string[]
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_revisions_step_id_workspace_id_fkey"
            columns: ["step_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      step_sources: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          created_at: string
          id: string
          locator: string
          note_markdown: string
          revision: number
          source_id: string
          status: string
          step_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          id?: string
          locator?: string
          note_markdown?: string
          revision?: number
          source_id: string
          status?: string
          step_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          id?: string
          locator?: string
          note_markdown?: string
          revision?: number
          source_id?: string
          status?: string
          step_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_sources_source_id_workspace_id_fkey"
            columns: ["source_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "step_sources_step_id_workspace_id_fkey"
            columns: ["step_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "step_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      steps: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          body_markdown: string
          branch_id: string
          concepts: string[]
          created_at: string
          id: string
          ordinal: number
          revision: number
          status: string
          strategy_id: string
          summary: string | null
          supersedes_step_id: string | null
          theorem_tags: string[]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          body_markdown: string
          branch_id: string
          concepts?: string[]
          created_at?: string
          id?: string
          ordinal: number
          revision?: number
          status?: string
          strategy_id: string
          summary?: string | null
          supersedes_step_id?: string | null
          theorem_tags?: string[]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          body_markdown?: string
          branch_id?: string
          concepts?: string[]
          created_at?: string
          id?: string
          ordinal?: number
          revision?: number
          status?: string
          strategy_id?: string
          summary?: string | null
          supersedes_step_id?: string | null
          theorem_tags?: string[]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "steps_branch_id_strategy_id_workspace_id_fkey"
            columns: ["branch_id", "strategy_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "strategy_id", "workspace_id"]
          },
          {
            foreignKeyName: "steps_supersedes_step_id_workspace_id_fkey"
            columns: ["supersedes_step_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "steps"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      strategies: {
        Row: {
          author_agent_name: string | null
          author_type: string
          author_user_id: string | null
          created_at: string
          description_markdown: string
          id: string
          objective_id: string
          revision: number
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          description_markdown?: string
          id?: string
          objective_id: string
          revision?: number
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_agent_name?: string | null
          author_type?: string
          author_user_id?: string | null
          created_at?: string
          description_markdown?: string
          id?: string
          objective_id?: string
          revision?: number
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategies_objective_workspace_fkey"
            columns: ["objective_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "objectives"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "strategies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          revision: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          revision?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          revision?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      branch_from_step: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_idempotency_key: string
          p_name: string
          p_step_id: string
        }
        Returns: Json
      }
      claim_step_embedding_jobs: {
        Args: {
          p_max_jobs?: number
          p_visibility_timeout_seconds?: number
          p_worker_token: string
        }
        Returns: {
          attempt: number
          content_hash: string
          embedding_model: string
          message_id: number
          search_text: string
          step_id: string
          workspace_id: string
        }[]
      }
      compare_branches: {
        Args: { p_branch_a_id: string; p_branch_b_id: string }
        Returns: Json
      }
      complete_step_embedding_job: {
        Args: {
          p_content_hash: string
          p_embedding: string
          p_embedding_model: string
          p_message_id: number
          p_step_id: string
          p_worker_token: string
        }
        Returns: Json
      }
      create_context_item: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_body_markdown?: string
          p_context_id?: string
          p_idempotency_key: string
          p_kind: string
          p_metadata?: Json
          p_mime_type?: string
          p_objective_id: string
          p_processing_status?: string
          p_scope: string
          p_size_bytes?: number
          p_source_url?: string
          p_storage_bucket?: string
          p_storage_path?: string
          p_title: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_objective: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_constraints_markdown: string
          p_idempotency_key: string
          p_objective_markdown: string
          p_title: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_step: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_body_markdown: string
          p_branch_id: string
          p_concepts?: string[]
          p_depends_on_step_ids?: string[]
          p_expected_branch_revision: number
          p_idempotency_key: string
          p_status?: string
          p_summary?: string
          p_supersedes_step_id?: string
          p_theorem_tags?: string[]
          p_title: string
        }
        Returns: Json
      }
      create_step_dependency: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_idempotency_key: string
          p_source_step_id: string
          p_target_step_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_strategy: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_description_markdown?: string
          p_idempotency_key: string
          p_objective_id: string
          p_root_branch_name?: string
          p_title: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_workspace: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_idempotency_key: string
          p_title: string
        }
        Returns: Json
      }
      find_steps: {
        Args: {
          p_branch_id?: string
          p_embedding_model?: string
          p_full_text_weight?: number
          p_objective_id?: string
          p_query_embedding?: string
          p_query_text: string
          p_rrf_k?: number
          p_semantic_weight?: number
          p_status?: string
          p_strategy_id?: string
          p_top_k?: number
          p_workspace_id: string
        }
        Returns: {
          branch_id: string
          combined_score: number
          full_text_rank: number
          objective_id: string
          objective_title: string
          semantic_rank: number
          snippet: string
          status: string
          step_id: string
          step_revision: number
          strategy_id: string
          strategy_title: string
          title: string
          workspace_id: string
        }[]
      }
      generate_clean_solution: { Args: { p_branch_id: string }; Returns: Json }
      get_branch_path: {
        Args: { p_branch_id: string }
        Returns: {
          author_agent_name: string
          author_type: string
          author_user_id: string
          body_markdown: string
          concepts: string[]
          ordinal: number
          owning_branch_id: string
          path_position: number
          revision: number
          status: string
          step_id: string
          summary: string
          theorem_tags: string[]
          title: string
        }[]
      }
      get_context: {
        Args: { p_objective_id?: string; p_workspace_id: string }
        Returns: Json
      }
      get_general_context: { Args: { p_workspace_id: string }; Returns: Json }
      get_objective_graph: { Args: { p_objective_id: string }; Returns: Json }
      get_workspace_overview: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      list_pending_decisions: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      list_workspace_summaries: { Args: never; Returns: Json }
      mark_assumption: {
        Args: {
          p_assumption_status?: string
          p_author_agent_name?: string
          p_author_type?: string
          p_idempotency_key: string
          p_label: string
          p_note_markdown?: string
          p_statement_markdown: string
          p_step_id: string
          p_usage_kind?: string
        }
        Returns: Json
      }
      mark_branch_completed: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_branch_id: string
          p_expected_branch_revision: number
          p_expected_strategy_revision: number
          p_idempotency_key: string
        }
        Returns: Json
      }
      mark_step_dead_end: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_expected_revision: number
          p_idempotency_key: string
          p_step_id: string
        }
        Returns: Json
      }
      request_human_decision: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_branch_id?: string
          p_idempotency_key: string
          p_kind?: string
          p_objective_id?: string
          p_question_markdown: string
          p_step_id?: string
          p_strategy_id?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      resolve_human_decision: {
        Args: {
          p_decision_id: string
          p_expected_revision: number
          p_idempotency_key: string
          p_resolution_markdown: string
          p_resolution_outcome: string
        }
        Returns: Json
      }
      save_clean_solution_snapshot: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_branch_id: string
          p_idempotency_key: string
        }
        Returns: Json
      }
      set_reasoning_result: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_expected_result_revision: number
          p_expected_target_revision: number
          p_idempotency_key: string
          p_objective_id: string
          p_outcome_status: string
          p_result_markdown: string
          p_target_id: string
          p_target_type: string
          p_workspace_id: string
        }
        Returns: Json
      }
      retry_step_embedding_job: {
        Args: {
          p_attempt: number
          p_error: string
          p_message_id: number
          p_visibility_timeout_seconds?: number
          p_worker_token: string
        }
        Returns: Json
      }
      update_objective: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_constraints_markdown?: string
          p_expected_revision: number
          p_idempotency_key: string
          p_objective_id: string
          p_objective_markdown?: string
          p_status?: string
          p_title?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      update_step: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_body_markdown?: string
          p_concepts?: string[]
          p_expected_revision: number
          p_idempotency_key: string
          p_status?: string
          p_step_id: string
          p_summary?: string
          p_theorem_tags?: string[]
          p_title?: string
        }
        Returns: Json
      }
      update_workspace: {
        Args: {
          p_author_agent_name?: string
          p_author_type?: string
          p_expected_revision: number
          p_idempotency_key: string
          p_status: string
          p_title: string
          p_workspace_id: string
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
