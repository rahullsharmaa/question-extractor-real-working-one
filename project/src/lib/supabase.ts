import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://example.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4YW1wbGUiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTY0MjU0MjQwMCwiZXhwIjoxOTU4MTE4NDAwfQ.example';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('Supabase environment variables not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Database = {
  public: {
    Tables: {
      exams: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
      };
      courses: {
        Row: {
          id: string;
          exam_id: string | null;
          name: string;
          description: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          exam_id?: string | null;
          name: string;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          exam_id?: string | null;
          name?: string;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
      };
      questions: {
        Row: {
          id: string;
          question_type: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective';
          question_statement: string;
          options: string[] | null;
          created_at: string | null;
          updated_at: string | null;
          course_id: string | null;
          categorized: boolean | null;
          year: number | null;
        };
        Insert: {
          id?: string;
          question_type: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective';
          question_statement: string;
          options?: string[] | null;
          created_at?: string | null;
          updated_at?: string | null;
          course_id?: string | null;
          categorized?: boolean | null;
          year?: number | null;
        };
        Update: {
          id?: string;
          question_type?: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective';
          question_statement?: string;
          options?: string[] | null;
          created_at?: string | null;
          updated_at?: string | null;
          course_id?: string | null;
          categorized?: boolean | null;
          year?: number | null;
        };
      };
    };
  };
};