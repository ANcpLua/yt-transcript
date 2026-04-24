import{r as l,g as N,a as C,j as t,h as U}from"./index-BXXJpHJX.js";const D=1e5,Y=4;function i(e){const r=D*Y;if(e.length<=r)return e;const d=Math.floor(r/2);return e.slice(0,d)+`

[... transcript truncated for length ...]

`+e.slice(-d)}const o="You analyze YouTube video transcripts. Be concise and accurate. Use timestamps (MM:SS) when referencing specific moments.",W={summary:{system:o,user:e=>`Provide a 3-5 sentence concise summary of this transcript:

${i(e)}`},bulletPoints:{system:o,user:e=>`Extract 5-10 key points as a bullet list from this transcript:

${i(e)}`},chapterSummary:{system:o,user:e=>`Identify the main sections/chapters in this transcript and summarize each with a heading and 1-2 sentences:

${i(e)}`},actionItems:{system:o,user:e=>`Extract all todos, recommendations, and next steps mentioned in this transcript as a checklist:

${i(e)}`},quotes:{system:o,user:e=>`Extract 3-7 notable or quotable passages from this transcript. Include the approximate timestamp for each:

${i(e)}`},blogOutline:{system:o,user:e=>`Create a structured blog post outline from this transcript with H2/H3 headings, intro, key sections, and conclusion:

${i(e)}`},socialPosts:{system:o,user:e=>`Write 3 social media post variants based on this transcript:
1. Twitter (max 280 characters)
2. LinkedIn (professional tone, 2-3 paragraphs)
3. Instagram/TikTok (casual, short)

${i(e)}`},studyNotes:{system:o,user:e=>`Create study notes from this transcript: key terms with definitions, main concepts, and their relationships:

${i(e)}`},flashcards:{system:o,user:e=>`Generate 10-20 Q&A flashcard pairs from this transcript. Format each as:
Q: [question]
A: [answer]

${i(e)}`},seoKeywords:{system:o,user:e=>`Extract SEO keywords from this transcript grouped by: Primary (3-5), Secondary (5-10), Related/Long-tail (5-10):

${i(e)}`},entities:{system:o,user:e=>`Extract all named entities from this transcript: people, companies, tools/products, URLs, and locations. Include approximate timestamps:

${i(e)}`},sentiment:{system:o,user:e=>`Analyze the sentiment and emotional arc of this transcript. Include:
1. Overall tone (positive/negative/neutral/mixed)
2. Emotional arc — how the tone shifts throughout
3. Any detected bias or persuasion techniques
4. Key emotional moments with timestamps

${i(e)}`},topics:{system:o,user:e=>`Extract the main topics and themes from this transcript. Provide:
1. Primary topics (3-5) with brief descriptions
2. Secondary topics (5-10)
3. Suggested hashtags (10-15, formatted as #hashtag)
4. One-line topic summary

${i(e)}`},qaExtract:{system:o,user:e=>`Find direct answers to common questions within this transcript. For each, provide:
- The implicit or explicit question being answered
- The direct answer from the transcript
- The approximate timestamp

Extract 5-15 Q&A pairs. Focus on factual, actionable answers.

${i(e)}`},mindmap:{system:o,user:e=>`Create a mermaid mindmap diagram representing the key concepts and their relationships from this transcript. Use this exact format:

\`\`\`mermaid
mindmap
  root((Main Topic))
    Branch 1
      Sub-topic
      Sub-topic
    Branch 2
      Sub-topic
\`\`\`

Include 3-6 main branches with 2-4 sub-topics each. Output ONLY the mermaid code block.

${i(e)}`},studyGuide:{system:o,user:e=>`Create a comprehensive study guide from this transcript with:
1. **Learning Objectives** — what you should know after studying
2. **Key Concepts** — definitions and explanations
3. **Detailed Notes** — organized by section with timestamps
4. **Summary** — 3-5 sentence recap
5. **Review Questions** — 5 questions to test understanding

${i(e)}`},qaGenerate:{system:o,user:e=>`Generate 10-15 question-answer pairs for review based on this transcript. Include a mix of:
- Factual recall questions
- Conceptual understanding questions
- Application questions

Format each as:
**Q:** [question]
**A:** [answer]

${i(e)}`},quiz:{system:o,user:e=>`Generate a 10-question multiple-choice quiz based on this transcript. For each question:
- Provide 4 options labeled A, B, C, D
- Mark the correct answer with ✓
- Include a brief explanation for the correct answer

Format:
**1. [Question]**
A) [option]
B) [option]
C) [option] ✓
D) [option]
*Explanation: [why C is correct]*

${i(e)}`}};function V(e){return`${o}

Here is the transcript you should answer questions about:

${i(e)}`}function O(){return self.ai}async function J(){try{const e=O();if(!(e!=null&&e.summarizer))return!1;const r=await e.summarizer.capabilities();return r.available==="readily"||r.available==="after-download"}catch{return!1}}async function X(e){const r=O();if(!(r!=null&&r.summarizer))throw new Error("Chrome AI Summarizer not available");if((await r.summarizer.capabilities()).available==="no")throw new Error("Summarizer not supported on this device");const n=await r.summarizer.create({type:"key-points",length:"medium"});try{return await n.summarize(e)}finally{n.destroy()}}const P=new Set(["summary"]),Z=[{id:"summary",label:"Summarize"},{id:"bulletPoints",label:"Key Points"},{id:"chapterSummary",label:"Chapters"},{id:"actionItems",label:"Action Items"},{id:"quotes",label:"Quotes"},{id:"sentiment",label:"Sentiment"},{id:"topics",label:"Topics & Tags"},{id:"qaExtract",label:"Q&A Extract"},{id:"mindmap",label:"Mindmap"},{id:"studyGuide",label:"Study Guide"},{id:"studyNotes",label:"Study Notes"},{id:"qaGenerate",label:"Q&A Generate"},{id:"quiz",label:"Quiz"},{id:"flashcards",label:"Flashcards"},{id:"blogOutline",label:"Blog Outline"},{id:"socialPosts",label:"Social Posts"},{id:"seoKeywords",label:"SEO Keywords"},{id:"entities",label:"Entities"}],ee=/(\d{1,2}:\d{2})/g,te=/^\d{1,2}:\d{2}$/;function M(e){return e.segments.map(r=>`[${U(r.start)}] ${r.text}`).join(`
`)}function se(e){const r=e.split(":").map(Number);return r.length===2?(r[0]??0)*60+(r[1]??0):0}function K(e){return new Promise((r,d)=>{chrome.runtime.sendMessage({type:"ai-request",...e},n=>{if(chrome.runtime.lastError){d(new Error(chrome.runtime.lastError.message??"Extension error"));return}if(!n){d(new Error("No response from background worker"));return}n.type==="ai-result"&&n.content?r(n.content):d(new Error(n.error??"AI request failed"))})})}function L({text:e,onSeek:r}){const d=e.split(ee);return t.jsx("div",{className:"prose prose-sm max-w-none whitespace-pre-wrap dark:prose-invert",children:d.map((n,p)=>te.test(n)?t.jsx("button",{onClick:()=>r(se(n)),className:"mx-0.5 rounded bg-blue-100 px-1 text-xs font-mono text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300",children:n},p):t.jsx("span",{children:n},p))})}function ne({transcript:e,onSeek:r}){const[d,n]=l.useState(null),[p,c]=l.useState(null),[m,u]=l.useState(!1),[b,f]=l.useState(null),[w,v]=l.useState([]),[k,I]=l.useState(""),[S,q]=l.useState(!1),T=l.useRef(null),[Q,$]=l.useState(new Set),[y,_]=l.useState(!1),[g,B]=l.useState(!1);l.useEffect(()=>{var s;(s=T.current)==null||s.scrollIntoView({behavior:"smooth"})},[w]),l.useEffect(()=>{J().then(_),(async()=>{const s=await N();if(!s.aiProvider)return;const a=await C(s.aiProvider);B(a!==null)})()},[]);const z=l.useCallback(s=>y&&P.has(s)||g,[y,g]),G=y||g,F=async s=>{if(e&&z(s)){c(s),u(!0),f(null),n(null),$(new Set);try{const a=M(e);if(y&&P.has(s)){const x=await X(a);n(x);return}const h=await N();if(!h.aiProvider)throw new Error("No AI provider configured");const A=await C(h.aiProvider);if(!A)throw new Error("No API key configured");const E=W[s],j=await K({provider:h.aiProvider,apiKey:A,systemPrompt:E.system,userMessage:E.user(a)});n(j)}catch(a){f(a instanceof Error?a.message:"AI request failed")}finally{u(!1)}}},R=async()=>{if(!k.trim()||!e||!g)return;const s={role:"user",content:k.trim()};v(a=>[...a,s]),I(""),q(!0);try{const a=await N();if(!a.aiProvider)throw new Error("No AI provider configured");const h=await C(a.aiProvider);if(!h)throw new Error("No API key configured");const A=V(M(e)),E=[...w,s].map(x=>`${x.role==="user"?"User":"Assistant"}: ${x.content}`).join(`

`),j=await K({provider:a.aiProvider,apiKey:h,systemPrompt:A,userMessage:E});v(x=>[...x,{role:"assistant",content:j}])}catch(a){v(h=>[...h,{role:"assistant",content:`Error: ${a instanceof Error?a.message:"Request failed"}`}])}finally{q(!1)}},H=()=>{d&&navigator.clipboard.writeText(d)};return e?t.jsxs("div",{className:"flex flex-col gap-4 rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800",children:[t.jsx("h3",{className:"text-lg font-bold text-gray-900 dark:text-white",children:"AI Analysis"}),y&&t.jsxs("div",{className:"flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-300",children:[t.jsx("svg",{className:"h-4 w-4 shrink-0",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:t.jsx("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:2,d:"M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"})}),"Chrome AI (Free) available — Summarize runs on-device. Advanced features require an API key."]}),!G&&t.jsxs("div",{className:"flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300",children:[t.jsx("svg",{className:"h-4 w-4 shrink-0",fill:"none",viewBox:"0 0 24 24",stroke:"currentColor",children:t.jsx("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:2,d:"M12 15v2m0 0v2m0-2h2m-2 0H10m9.374-9.373A9 9 0 115.626 5.626 9 9 0 0119.374 14.627z"})}),"Add an API key in Settings to use AI features."]}),t.jsx("div",{className:"flex flex-wrap gap-2",children:Z.map(s=>{const a=z(s.id),h=y&&P.has(s.id);return t.jsxs("button",{onClick:()=>void F(s.id),disabled:!a||m,title:h?"Free via Chrome AI":void 0,className:`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${p===s.id?"bg-blue-600 text-white":"bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"}`,children:[s.label,h&&t.jsx("span",{className:"ml-1 text-xs opacity-70",children:"(free)"})]},s.id)})}),m&&t.jsxs("div",{className:"flex items-center gap-2 py-4 text-sm text-gray-500",children:[t.jsx("div",{className:"h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"}),"Analyzing transcript..."]}),b&&t.jsx("div",{className:"rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400",children:b}),d&&!m&&t.jsxs("div",{className:"rounded-lg bg-gray-50 p-4 dark:bg-gray-900",children:[p==="flashcards"?t.jsx(re,{result:d,flippedCards:Q,setFlippedCards:$}):t.jsx(L,{text:d,onSeek:r}),t.jsxs("div",{className:"mt-3 flex gap-2",children:[t.jsx("button",{onClick:H,className:"rounded bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300",children:"Copy"}),t.jsx("button",{onClick:()=>p&&void F(p),className:"rounded bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300",children:"Regenerate"})]})]}),t.jsxs("div",{className:"border-t pt-4 dark:border-gray-700",children:[t.jsxs("div",{className:"mb-2 flex items-center justify-between",children:[t.jsx("h4",{className:"text-sm font-semibold text-gray-700 dark:text-gray-300",children:"Ask the transcript"}),w.length>0&&t.jsx("button",{onClick:()=>v([]),className:"text-xs text-gray-400 hover:text-gray-600",children:"Clear chat"})]}),w.length>0&&t.jsxs("div",{className:"mb-3 max-h-64 space-y-2 overflow-y-auto rounded-lg bg-gray-50 p-3 dark:bg-gray-900",children:[w.map((s,a)=>t.jsx("div",{className:`rounded-lg p-2 text-sm ${s.role==="user"?"ml-8 bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200":"mr-8 bg-white dark:bg-gray-800 dark:text-gray-200"}`,children:t.jsx(L,{text:s.content,onSeek:r})},a)),S&&t.jsx("div",{className:"mr-8 rounded-lg bg-white p-2 dark:bg-gray-800",children:t.jsx("div",{className:"h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"})}),t.jsx("div",{ref:T})]}),t.jsxs("div",{className:"flex gap-2",children:[t.jsx("input",{value:k,onChange:s=>I(s.target.value),onKeyDown:s=>s.key==="Enter"&&!s.shiftKey&&void R(),placeholder:g?"Ask a question about this video...":"Add API key to chat",disabled:!g||S,className:"flex-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"}),t.jsx("button",{onClick:()=>void R(),disabled:!g||S||!k.trim(),className:"rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50",children:"Send"})]})]})]}):null}function re({result:e,flippedCards:r,setFlippedCards:d}){const n=e.split(/\n(?=Q:)/g).map(c=>{const m=c.match(/Q:\s*(.+)/),u=c.match(/A:\s*([\s\S]+)/),b=m==null?void 0:m[1],f=u==null?void 0:u[1];return b&&f?{q:b.trim(),a:f.trim()}:null}).filter(c=>c!==null),p=c=>d(m=>{const u=new Set(m);return u.has(c)?u.delete(c):u.add(c),u});return t.jsx("div",{className:"grid gap-3 sm:grid-cols-2",children:n.map((c,m)=>t.jsxs("button",{onClick:()=>p(m),className:"rounded-lg border p-3 text-left transition hover:shadow dark:border-gray-600",children:[t.jsx("p",{className:"text-sm font-medium text-gray-900 dark:text-white",children:c.q}),r.has(m)&&t.jsx("p",{className:"mt-2 border-t pt-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400",children:c.a})]},m))})}export{ne as AiPanel};
