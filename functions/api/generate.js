export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();
    const { projectName, studentName, sessionInfo, reportDate, teacherName, student_comment, teacher_comment, storyboardImg, processImg, finalImg } = data;

    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    const basePrompt = `
    다음 미술 수업 데이터를 바탕으로 리포트의 모든 필드를 최적으로 완성해줘. 
    기존에 입력된 내용이 있다면 그것을 바탕으로 더 전문적이고 다정한 어조로 '개선'하고, 비어있는 필드는 사진 분석과 문맥을 통해 자연스럽게 '추론'해서 채워줘.

    [필드별 작성 지침]
    1. projectName: 프로젝트의 성격을 잘 나타내는 멋진 이름을 지어줘. (기존 내용이 있으면 개선)
    2. studentName: 아이의 이름을 추론하거나 기존 이름을 사용해. (모를 경우 "꿈꾸는 아이" 등으로 정해줘)
    3. sessionInfo: 몇 회차인지 추론해. (모를 경우 "1회차" 등 적절히 생성)
    4. reportDate: 비어있으면 "${today}"로 채워줘.
    5. teacherName: 선생님의 이름을 멋지게 지어줘. (기존 내용이 있으면 개선)
    6. student_comment (수업 활동 내용): 학생이 오늘 수행한 구체적인 작업물과 특징을 1~2문장으로 생생하게 요약해줘.
    7. teacher_comment: 그림 결과물과 수업태도, 창의성을 종합 분석하여 3~4문장으로 따뜻하고 다정하게 격려해줘. (~해요체 사용)

    [입력 데이터]
    - 기존 프로젝트명: ${projectName || '입력 안됨'}
    - 기존 학생명: ${studentName || '입력 안됨'}
    - 기존 회차: ${sessionInfo || '입력 안됨'}
    - 기존 날짜: ${reportDate || '입력 안됨'}
    - 기존 선생님: ${teacherName || '입력 안됨'}
    - 기존 수업 활동 내용: ${student_comment || '입력 안됨'}
    - 기존 선생님 코멘트: ${teacher_comment || '입력 안됨'}

    반드시 다음 JSON 형식으로만 반환해. 다른 텍스트는 섞지 마.
    {
      "projectName": "...",
      "studentName": "...",
      "sessionInfo": "...",
      "reportDate": "...",
      "teacherName": "...",
      "student_comment": "...",
      "teacher_comment": "..."
    }
    `;

    const parseImage = (dataUrl) => {
      if (!dataUrl) return null;
      const match = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (!match) return null;
      return { media_type: match[1], data: match[2], dataUrl };
    };

    const imgs = [
      parseImage(storyboardImg),
      parseImage(processImg),
      parseImage(finalImg)
    ].filter(Boolean);

    let result = null;

    // 1st Priority: Anthropic
    if (env.ANTHROPIC_API_KEY) {
      try {
         const anthropicContent = [{ type: 'text', text: basePrompt }];
         for (const img of imgs) {
            anthropicContent.push({
               type: 'image',
               source: {
                 type: 'base64',
                 media_type: img.media_type,
                 data: img.data
               }
            });
         }

         const response = await fetch('https://api.anthropic.com/v1/messages', {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
             'x-api-key': env.ANTHROPIC_API_KEY,
             'anthropic-version': '2023-06-01'
           },
           body: JSON.stringify({
             model: 'claude-3-5-sonnet-20240620',
             max_tokens: 1500,
             system: "You are a professional art education consultant. You must output perfectly valid JSON without backticks or extra text.",
             messages: [{ role: 'user', content: anthropicContent }]
           })
         });

         if (response.ok) {
           const json = await response.json();
           const text = json.content[0].text;
           const match = text.match(/\{[\s\S]*?\}/);
           if (match) {
             result = JSON.parse(match[0]);
           } else {
             result = JSON.parse(text);
           }
         }
      } catch (err) { console.error('Anthropic Request Failed:', err); }
    }

    // 2nd Priority: OpenAI (fallback)
    if (!result && env.OPENAI_API_KEY) {
      try {
         const openaiContent = [{ type: 'text', text: basePrompt }];
         for (const img of imgs) {
            openaiContent.push({
               type: 'image_url',
               image_url: { url: img.dataUrl }
            });
         }

         const response = await fetch('https://api.openai.com/v1/chat/completions', {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
             'Authorization': `Bearer ${env.OPENAI_API_KEY}`
           },
           body: JSON.stringify({
             model: 'gpt-4o',
             response_format: { type: 'json_object' },
             temperature: 0.7,
             messages: [{ role: 'user', content: openaiContent }]
           })
         });

         if (response.ok) {
           const json = await response.json();
           result = JSON.parse(json.choices[0].message.content);
         }
      } catch (err) { console.error('OpenAI Request Failed:', err); }
    }

    if (!result) {
        return new Response(JSON.stringify({ error: 'Failed to generate content.' }), { status: 500, headers: corsHeaders() });
    }

    return new Response(JSON.stringify(result), { headers: corsHeaders() });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
  }
}
