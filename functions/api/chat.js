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
    const { projectName, studentName, sessionInfo, storyboardImg, processImg, finalImg } = data;

    const basePrompt = `
    다음 미술 수업 데이터를 바탕으로 '수업 활동 내용'과 '선생님 코멘트'를 작성해줘. 
    수업 활동 내용은 학생이 오늘 수업에서 진행한 구체적인 작업(예: 기획, 스케치, 채색, 기법 등)과 특징적인 활동을 1~2문장 내외로 생생하고 객관적으로 요약해줘.
    선생님 코멘트는 첨부된 '그림 결과물과 과정'에 대한 전문적이고 구체적인 시각적 분석과, '수업 관찰' 내용(아이의 태도, 문제 해결 방식, 몰입도, 창의성 등)을 통합 포괄해서 3~4문장으로 따뜻하고 다정하게 작성해줘. 선생님 코멘트는 주로 "~했습니다.", "~해서 참 다채롭고 멋졌습니다." 같은 격려와 칭찬의 해요체를 사용해줘.

    [기본 정보]
    프로젝트/수업 이름: ${projectName || '입력 안됨'}
    학생 이름: ${studentName || '입력 안됨'}
    회차: ${sessionInfo || '입력 안됨'}

    반드시 JSON 형식으로 반환해.
    {
      "student_comment": "...",
      "teacher_comment": "..."
    }
    `;

    // Extract mime type and base64 from data URL
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
             model: 'claude-3-5-sonnet-20240620', // or whatever latest claude 3.5 is configured in anthropic
             max_tokens: 1024,
             system: "You are a friendly art teacher's assistant. You must output perfectly valid JSON without backticks.",
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
         } else {
            console.error('Anthropic Error:', await response.text());
         }
      } catch (err) {
         console.error('Anthropic Request Failed:', err);
      }
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
         } else {
            console.error('OpenAI Error:', await response.text());
         }
      } catch (err) {
         console.error('OpenAI Request Failed:', err);
      }
    }

    if (!result) {
      return new Response(JSON.stringify({ error: 'Failed to generate comments from both Anthropic and OpenAI. Please check your API Keys in Cloudflare Dashboard.' }), { status: 500, headers: corsHeaders() });
    }

    return new Response(JSON.stringify(result), { headers: corsHeaders() });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
  }
}
