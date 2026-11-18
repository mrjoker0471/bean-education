// Shared profile vocabulary (Phase 2B onboarding + settings profile editor).
// Mirrors the validated enums in /api/student/profile — keep both in sync.
// Labels are presentation-only; the stored values are the stable enum keys.

import type { EducationCategory, LearningLevel, LearningStyle } from './types'

export type { EducationCategory, LearningStyle }

export interface ProfileOption<V extends string> {
  value: V
  label: string
  hint?: string
}

export const EDUCATION_CATEGORY_OPTIONS: ProfileOption<EducationCategory>[] = [
  { value: 'SCHOOL', label: 'School', hint: 'Classes 6–12' },
  { value: 'COLLEGE', label: 'College', hint: 'Undergraduate courses' },
  { value: 'UNIVERSITY', label: 'University', hint: 'Degree & postgraduate' },
  { value: 'CA_CMA_CS', label: 'CA / CMA / CS', hint: 'Professional commerce courses' },
  { value: 'COMPETITIVE', label: 'Competitive exams', hint: 'Entrance & government recruitment' },
  { value: 'SKILL', label: 'Skill learning', hint: 'Courses & self-study' },
  { value: 'CAREER', label: 'Career development', hint: 'Upskilling for work' },
]

export const LEARNING_LEVEL_OPTIONS: ProfileOption<LearningLevel>[] = [
  { value: 'SCHOOL_6_8', label: 'School · Classes 6–8' },
  { value: 'SCHOOL_9_10', label: 'School · Classes 9–10' },
  { value: 'SCHOOL_11_12', label: 'School · Classes 11–12' },
  { value: 'UNDERGRAD', label: 'Undergraduate' },
  { value: 'POSTGRAD', label: 'Postgraduate' },
  { value: 'PROFESSIONAL', label: 'Professional course (CA/CMA/CS…)' },
  { value: 'COMPETITIVE', label: 'Competitive exam preparation' },
  { value: 'SKILL', label: 'Skill / self-learning' },
]

/** Which levels each education category most likely maps to (suggestions only). */
export const CATEGORY_LEVEL_SUGGESTIONS: Record<EducationCategory, LearningLevel[]> = {
  SCHOOL: ['SCHOOL_6_8', 'SCHOOL_9_10', 'SCHOOL_11_12'],
  COLLEGE: ['UNDERGRAD'],
  UNIVERSITY: ['UNDERGRAD', 'POSTGRAD'],
  CA_CMA_CS: ['PROFESSIONAL'],
  COMPETITIVE: ['COMPETITIVE'],
  SKILL: ['SKILL'],
  CAREER: ['PROFESSIONAL', 'SKILL'],
}

export const LEARNING_STYLE_OPTIONS: ProfileOption<LearningStyle>[] = [
  { value: 'CONCEPT_FIRST', label: 'Concepts first', hint: 'Understand, then practise' },
  { value: 'PRACTICE_FIRST', label: 'Practice first', hint: 'Learn by solving' },
  { value: 'VISUAL', label: 'Visual notes', hint: 'Diagrams & summaries' },
  { value: 'REVISE_OFTEN', label: 'Frequent revision', hint: 'Short, repeated passes' },
]

export const LANGUAGE_OPTIONS = [
  'English',
  'हिन्दी (Hindi)',
  'தமிழ் (Tamil)',
  'বাংলা (Bengali)',
  'मराठी (Marathi)',
  'తెలుగు (Telugu)',
  'ગુજરાતી (Gujarati)',
  'ಕನ್ನಡ (Kannada)',
  'മലയാളം (Malayalam)',
  'ਪੰਜਾਬੀ (Punjabi)',
] as const

export const DAILY_MINUTES_OPTIONS = [15, 30, 45, 60, 90, 120, 180] as const

/** Suggested interest chips (students can add their own free-text interests too). */
export const INTEREST_SUGGESTIONS = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'Computer Science',
  'Programming',
  'Accounting',
  'Finance',
  'Economics',
  'Business',
  'History',
  'Geography',
  'Civics',
  'Political Science',
  'Sociology',
  'Psychology',
  'English',
  'Hindi',
  'Tamil',
  'Law',
  'Medicine',
  'Engineering',
  'Data Science',
  'Design',
  'Languages',
  'Music',
  'General knowledge',
] as const

export function labelForCategory(value: unknown): string {
  return EDUCATION_CATEGORY_OPTIONS.find(o => o.value === value)?.label ?? String(value ?? '')
}

export function labelForLevel(value: unknown): string {
  return LEARNING_LEVEL_OPTIONS.find(o => o.value === value)?.label ?? String(value ?? '')
}

export function labelForStyle(value: unknown): string {
  return LEARNING_STYLE_OPTIONS.find(o => o.value === value)?.label ?? String(value ?? '')
}
