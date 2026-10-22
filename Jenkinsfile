// Item 4.1: CI wiring stub. playwright.config.ts's comments assume Jenkins
// is the real target CI, but no Jenkinsfile had actually been written yet -
// this is a STARTING POINT demonstrating the meta -> smoke -> sharded-main
// -> merge shape (items 3.3/4.1/4.3), not a drop-in pipeline. Before using
// this for real, adjust: the `agent` label to your real executors, the
// `credentials(...)` ids to your actual Jenkins credential store entries,
// and `shardTotal` to however many workers you actually want to fan out to.
//
// See .github/workflows/playwright.yml for the same shape as a GitHub
// Actions workflow, kept alongside this file because it's immediately
// runnable without a Jenkins instance to validate the pattern end to end.
pipeline {
    agent any

    environment {
        BAT_APP_BASE_URL = credentials('bat-app-base-url')
        BAT_APP_USERNAME = credentials('bat-app-username')
        BAT_APP_PASSWORD = credentials('bat-app-password')
        CI = 'true' // playwright.config.ts adds the "blob" reporter when this is set
    }

    stages {
        stage('Install') {
            steps {
                // Workspaces are reused between builds: without this, a build that fails early
                // (e.g. at the smoke gate) would triage and archive the PREVIOUS build's results.
                sh 'rm -f test-results/results*.json heal-report.json script-review-report.json'
                sh 'npm ci'
                sh 'npx playwright install --with-deps chromium'
            }
        }

        stage('Generator regression (meta)') {
            // No app dependency - runs even if the target environment is down.
            steps {
                sh 'npm run test:meta'
                // Static review of the shipped scripts: error-level findings fail the build.
                sh 'npm run review-scripts -- --strict'
                // Generated learned-patterns files must match .learnings/patterns/.
                sh 'npm run learn-publish -- --check'
            }
        }

        stage('Smoke gate') {
            // Item 3.3: must pass before the main suite is allowed to run.
            steps {
                // Its own results file, so an outage at the gate is triaged by the healer too.
                withEnv(['BAT_RESULTS_FILE=test-results/results-smoke.json']) {
                    sh 'npm run test:smoke'
                }
            }
        }

        stage('Main suite (sharded)') {
            steps {
                script {
                    def shardTotal = 4
                    def branches = [:]
                    for (int i = 1; i <= shardTotal; i++) {
                        def shardIndex = i
                        branches["shard-${shardIndex}"] = {
                            // Shards share ONE workspace here, so each needs its own results
                            // file or they overwrite each other's test-results/results.json.
                            withEnv(["BAT_RESULTS_FILE=test-results/results-${shardIndex}.json"]) {
                                sh "npx playwright test tests/example --project=main --shard=${shardIndex}/${shardTotal}"
                            }
                        }
                    }
                    parallel branches
                }
            }
        }

        stage('Merge reports') {
            // Item 4.3: combine each shard's blob report into one HTML report.
            steps {
                sh 'npx playwright merge-reports --reporter=html ./blob-report'
            }
        }

        stage('Analyze skill signals') {
            // All 4 shards from the previous stage ran via Groovy `parallel`
            // in this SAME workspace (agent any, one node), so - unlike the
            // GitHub Actions matrix (separate ephemeral VMs per shard, see
            // playwright.yml) - every shard's .flaky-trend/ run file is
            // already sitting right here on disk; nothing to download or
            // merge. This stage just runs the actual aggregation step so the
            // continuous-improvement loop's flaky signal reaches
            // skill-attention-report.json instead of only existing as
            // unread shard files, which is what the old
            // `archiveArtifacts artifacts: 'flaky-trend.json'` line below
            // used to silently miss (that path was the pre-sharding legacy
            // single file, not the .flaky-trend/ directory the reporter
            // actually writes now - see FlakyQuarantineReporter.ts).
            steps {
                sh 'npm run analyze-skills -- --days 30'
            }
        }
    }

    post {
        success {
            // Jenkins re-runs: this build is green. If an earlier build on this branch failed, the
            // edits made since then are the fixes for it, so capture them LINKED to that failure
            // (needs the Copy Artifact plugin; every step is optional - no plugin or no earlier
            // failure just means the edits are captured without the failure link).
            // NOTE: on Jenkins the captured events are only ARCHIVED with the build. Nothing here pushes them
            // anywhere (no credentials are assumed). To feed the shared store, either use the GitHub workflow
            // .github/workflows/learning.yml (it captures from git, which is where the fixes live), or add a
            // step that copies learning-events/*.json into the bat-learning data branch or your central store.
            script {
                try {
                    copyArtifacts(projectName: env.JOB_NAME, selector: lastFailed(), filter: 'heal-report.json', target: 'prev-heal', optional: true)
                } catch (err) {
                    echo "Copy Artifact plugin not available - capturing without a failure link."
                }
            }
            sh '''
                BASE=${CHANGE_TARGET:-main}
                git fetch origin "$BASE" >/dev/null 2>&1 || true
                HEAL=""
                [ -f prev-heal/heal-report.json ] && HEAL="--heal-report prev-heal/heal-report.json"
                npm run learn-capture -- --range "origin/$BASE..HEAD" --write --out-dir learning-events --summary $HEAL || echo "learn-capture skipped."
            '''
            archiveArtifacts artifacts: 'learning-events/**', allowEmptyArchive: true
        }
        always {
            // Failure triage. Runs in post{} so it still happens when a shard failed
            // (which is exactly when it is needed). Diagnosis only; nothing is edited.
            sh '''
                if ls test-results/results-*.json >/dev/null 2>&1; then
                    npm run heal-analyze -- test-results/results-*.json || echo "heal-analyze failed - see the output above."
                else
                    echo "No results files to analyze."
                fi
            '''
            archiveArtifacts artifacts: 'heal-report.json', allowEmptyArchive: true
            archiveArtifacts artifacts: 'script-review-report.json', allowEmptyArchive: true
            archiveArtifacts artifacts: 'test-results/results-*.json', allowEmptyArchive: true
            archiveArtifacts artifacts: 'playwright-report/**', allowEmptyArchive: true
            archiveArtifacts artifacts: '.flaky-trend/**', allowEmptyArchive: true
            archiveArtifacts artifacts: 'skill-attention-report.json', allowEmptyArchive: true
        }
    }
}
