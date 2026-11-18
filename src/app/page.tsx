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
import { PracticeView } from '@/components/bean/views/practice-view'
import { TopicsView } from '@/components/bean/views/topics-view'
import { SettingsView } from '@/components/bean/views/settings-view'
import { AuthView } from '@/components/bean/auth-view'
import { PdfViewerPage } from '@/components/bean/pdf-viewer'
import { Compass, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Page() {
  const route = useAppStore(s => s.route)
  const init = useAppStore(s => s.init)
  const hydrated = useAppStore(s => s._hydrated)
  const navigate = useAppStore(s => s.navigate)

  useEffect(() => { init() }, [init])

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <Header />
      <main className="flex-1" id="main">
        {!hydrated ? (
          <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading BEAN EXAMS">
            <Loader2 className="h-6 w-6 animate-spin text-gold" />
          </div>
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
            {route.view === 'practice' && <PracticeView doc={route.doc} topics={route.topics} />}
            {route.view === 'topics' && <TopicsView />}
            {route.view === 'settings' && <SettingsView />}
            {route.view === 'auth' && (
              <AuthView
                onAuthed={() => {
                  // AuthView performs its own fetch (deliberately store-free);
                  // the shell syncs the session into the store, then continues.
                  void useAppStore.getState().refreshAuth()
                  navigate({ view: 'settings' })
                }}
              />
            )}
            {route.view === 'not-found' && <NotFound />}
          </>
        )}
      </main>
      <Footer />
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
        That link doesn&apos;t match anything in the BEAN EXAMS catalogue.
      </p>
      <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'home' })}>
        Back to home
      </Button>
    </div>
  )
}
