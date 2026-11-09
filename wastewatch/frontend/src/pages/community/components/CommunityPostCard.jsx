/**
 * CommunityPostCard.jsx
 * ---------------------
 * Unified Card Dispatcher for WasteWatch Community Feed.
 * Routes presentation based on authoritative post_type:
 * - post_type === 'report' || post.report != null -> OfficialReportCard
 * - post_type === 'discussion' -> CivicDiscussionCard
 *
 * Guarantees distinct visual layouts and prevents cross-pollination
 * of fields or presentation styles between civic discussions and
 * official waste reports.
 *
 * Strict Iconography Rule: Zero emojis. Lucide SVG icons only.
 */

import OfficialReportCard from './OfficialReportCard'
import CivicDiscussionCard from './CivicDiscussionCard'

export default function CommunityPostCard(props) {
  const isReport = props.post?.post_type === 'report' || props.post?.report != null

  if (isReport) {
    return <OfficialReportCard {...props} />
  }

  return <CivicDiscussionCard {...props} />
}
