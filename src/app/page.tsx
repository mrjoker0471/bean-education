'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { Header } from '@/components/bean/header'
import { Footer } from '@/components/bean/footer'
import { HomeView } from '@/components/bean/views/home-view'
import { CatalogView } from '@/components/bean/views/catalog-view'
import { ExamView } from '@/components/bean/views/exam-view'
import { TopicView } from '@/components/bean/views/topic-view'
import { TestRunnerView } from '@/components/bean/views/test-runner-view'
import { ResultView } from '@/components/bean/views/result-view'
import { BeanView } from '@/components/bean/views/bean-view'
import { ProgressView } from '@/components/bean/views/progress-view'
import { MaterialsView } from '@/components/bean/views/materials-view'
import { RiisheView } from '@/components/bean/views/riishe-view'
import { RiisheResearchView } from '@/components/bean/views/riishe-research-view'
import { PracticeView } from '@/components/bean/views/practice-view'
import { TopicsView } from '@/components/bean/views/topics-view'
import { SettingsView } from '@/components/bean/views/settings-view'
import { OnboardingView } from '@/components/bean/views/onboarding-view'
import { DashboardView } from '@/components/bean/views/dashboard-view'
import { WorkspaceView } from '@/components/bean/views/workspace-view'
import { GoalsView } from '@/components/bean/views/goals-view'
import { LearningView } from '@/components/bean/views/learning-view'
import { PyqStudioView } from '@/components/bean/views/pyq-studio-view'
import { ClassesView } from '@/components/bean/views/classes-view'
import { ClassDetailView } from '@/components/bean/views/class-detail-view'
import { TeacherApplyView } from '@/components/bean/views/teacher-apply-view'
import { TeacherDashboardView } from '@/components/bean/views/teacher-dashboard-view'
import { TeacherReviewView } from '@/components/bean/views/teacher-review-view'
import { ClassroomView } from '@/components/bean/views/classroom-view'
import { AdminTrustView } from '@/components/bean/views/admin-trust-view'
import { MyReportsView } from '@/components/bean/views/my-reports-view'
import { TrustPolicyView } from '@/components/bean/views/trust-policy-view'
import { TermsView } from '@/components/bean/views/terms-view'
import { PrivacyView } from '@/components/bean/views/privacy-view'
import { LegalReacceptanceView } from '@/components/bean/views/legal-acceptance-view'
// Phase 7 — Institution & Career
import { InstitutionView } from '@/components/bean/views/institution-view'
import { InstitutionOrgView } from '@/components/bean/views/institution-org-view'
import { InstitutionGroupView } from '@/components/bean/views/institution-group-view'
import { CareerView } from '@/components/bean/views/career-view'
import { CareerProfileView } from '@/components/bean/views/career-profile-view'
import { CareerPortfolioView } from '@/components/bean/views/career-portfolio-view'
import { OpportunityBrowseView, OpportunityDetailView } from '@/components/bean/views/career-opportunities-view'
import { CareerApplicationsView } from '@/components/bean/views/career-applications-view'
import { CareerEmployerView } from '@/components/bean/views/career-employer-view'
import { AdminOrganizationsView } from '@/components/bean/views/admin-organizations-view'
import { AdminCareerView } from '@/components/bean/views/admin-career-view'
import { AuthView } from '@/components/bean/auth-view'
import { PdfViewerPage } from '@/components/bean/pdf-viewer'
import { resolvePostAuthRoute } from '@/lib/teacher-intent'
import { BeanEmblem, BeanWordmarkImage } from '@/components/bean/brand-mark'
import { Compass, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Views that stay reachable during legal re-acceptance — logout, export,
 *  deletion and grievance/privacy paths are never blocked (milestone rule). */
const REACCEPTANCE_ALLOWED_VIEWS = new Set(['settings', 'auth', 'terms', 'privacy', 'trust-policy'])

export default function Page() {
  const route = useAppStore(s => s.route)
  const init = useAppStore(s => s.init)
  const hydrated = useAppStore(s => s._hydrated)
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const legalStatus = useAppStore(s => s.legalStatus)

  useEffect(() => { init() }, [init])

  // Legal re-acceptance gate: existing users see a clear re-acceptance screen
  // when a material version changes — never implied by a mere sign-in. Access
  // to settings (export / deletion / logout), policies and the privacy request
  // path is preserved.
  const legalGateActive =
    Boolean(authedStudent) && legalStatus?.reacceptanceRequired === true &&
    !REACCEPTANCE_ALLOWED_VIEWS.has(route.view)

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <Header />
      <main className="flex-1" id="main">
        {!hydrated ? (
          <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading BEAN Education">
            <Loader2 className="h-6 w-6 animate-spin text-gold" />
          </div>
        ) : legalGateActive ? (
          // Re-acceptance replaces every other view — except the allowed
          // policy/settings routes, which stay reachable (logout, export,
          // deletion, grievance paths are never blocked).
          <LegalReacceptanceView />
        ) : (
          <>
            {route.view === 'home' && <HomeView />}
            {route.view === 'catalog' && <CatalogView />}
            {route.view === 'exam' && route.slug && <ExamView slug={route.slug} initialTab={route.tab} />}
            {route.view === 'topic' && route.topicId && <TopicView topicId={route.topicId} />}
            {route.view === 'test' && route.attemptId && <TestRunnerView attemptId={route.attemptId} />}
            {route.view === 'result' && route.attemptId && <ResultView attemptId={route.attemptId} />}
            {route.view === 'bean' && <BeanView seeded={route.seeded} />}
            {route.view === 'progress' && <ProgressView />}
            {route.view === 'pdf' && route.resourceId && <PdfViewerPage resourceId={route.resourceId} />}
            {route.view === 'materials' && <MaterialsView />}
            {route.view === 'riishe' && <RiisheView docId={route.docId} page={route.page} topic={route.topic} />}
            {route.view === 'riishe-research' && <RiisheResearchView />}
            {route.view === 'riishe-research-session' && <RiisheResearchView sessionId={route.sessionId} />}
            {route.view === 'practice' && <PracticeView doc={route.doc} topics={route.topics} />}
            {route.view === 'topics' && <TopicsView />}
            {route.view === 'settings' && <SettingsView />}
            {route.view === 'onboarding' && <OnboardingView edit={route.edit} />}
            {route.view === 'dashboard' && <DashboardView />}
            {route.view === 'workspace' && <WorkspaceView />}
            {route.view === 'goals' && <GoalsView />}
            {route.view === 'learning' && <LearningView />}
            {route.view === 'pyq-studio' && <PyqStudioView />}
            {route.view === 'classes' && <ClassesView initialTab={route.tab} />}
            {route.view === 'class' && route.classId && <ClassDetailView classId={route.classId} />}
            {route.view === 'teach-apply' && <TeacherApplyView />}
            {route.view === 'teach-dashboard' && <TeacherDashboardView />}
            {route.view === 'teach-review' && <TeacherReviewView />}
            {route.view === 'classroom' && route.classId && <ClassroomView classId={route.classId} />}
            {route.view === 'admin-trust' && <AdminTrustView />}
            {route.view === 'my-reports' && <MyReportsView />}
            {route.view === 'trust-policy' && <TrustPolicyView />}
            {/* Public experience, authentication & legal foundation */}
            {route.view === 'terms' && <TermsView />}
            {route.view === 'privacy' && <PrivacyView />}
            {/* Phase 7 — Institution & Career */}
            {route.view === 'institution' && <InstitutionView />}
            {route.view === 'institution-org' && route.orgId && <InstitutionOrgView orgId={route.orgId} section={route.section} />}
            {route.view === 'institution-group' && route.orgId && route.groupId && (
              <InstitutionGroupView orgId={route.orgId} groupId={route.groupId} tab={route.tab} />
            )}
            {route.view === 'career' && <CareerView />}
            {route.view === 'career-profile' && <CareerProfileView />}
            {route.view === 'career-portfolio' && <CareerPortfolioView />}
            {route.view === 'career-opportunities' && <OpportunityBrowseView />}
            {route.view === 'career-opportunity' && route.opportunityId && <OpportunityDetailView opportunityId={route.opportunityId} />}
            {route.view === 'career-applications' && <CareerApplicationsView />}
            {route.view === 'career-employer' && <CareerEmployerView />}
            {route.view === 'career-employer-org' && route.orgId && <CareerEmployerView />}
            {route.view === 'admin-organizations' && <AdminOrganizationsView />}
            {route.view === 'admin-career' && <AdminCareerView />}
            {route.view === 'auth' && (
              <AuthStage>
                <AuthView
                  onAuthed={(student, mode, intent) => {
                    // The auth panel already holds the confirmed server response —
                    // set it synchronously, claim this device's guest data, then
                    // route by onboarding state + audience intent + REAL teacher
                    // application status. The audience choice never grants rights:
                    // teacher routing still resolves through the server-side
                    // application lifecycle.
                    useAppStore.setState({ authedStudent: student, authChecked: true })
                    const gid = useAppStore.getState().guestId
                    if (gid) void useAppStore.getState().claimGuestData().catch(() => undefined)
                    void resolvePostAuthRoute(student, intent).then(dest => navigate(dest))
                  }}
                />
              </AuthStage>
            )}
            {route.view === 'not-found' && <NotFound />}
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}

/** Authentication stage — the art-directed obsidian surface every sign-in,
 *  sign-up, Google-link and re-acceptance panel sits on. The panel itself
 *  (AuthView) keeps its entire flow; only the stage around it is styled. */
function AuthStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[72vh] flex-col items-center justify-center overflow-hidden px-4 py-14 obsidian-ambient sm:py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent 8%, rgba(198,160,94,0.30) 50%, transparent 92%)' }}
      />
      <div className="relative flex w-full max-w-md flex-col items-center text-center">
        <BeanEmblem className="h-16 w-16" />
        <BeanWordmarkImage className="mt-4 h-7 w-auto min-w-[190px]" />
        <p className="mt-2.5 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
          Learn. Practise. Teach. Grow.
        </p>
        <div className="mt-8 w-full">{children}</div>
      </div>
    </div>
  )
}

function NotFound() {
  const navigate = useAppStore(s => s.navigate)
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <Compass className="mb-4 h-10 w-10 text-gold" />
      <h1 className="font-display text-2xl font-semibold text-foreground">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        That link doesn&apos;t match anything in the BEAN Education catalogue.
      </p>
      <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'home' })}>
        Back to home
      </Button>
    </div>
  )
}
