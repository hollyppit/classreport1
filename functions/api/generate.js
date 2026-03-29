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

async function callAI(prompt, env, systemPrompt, isJson = true) {
  let result = null;

  // 1st Priority: Anthropic
  if (env.ANTHROPIC_API_KEY) {
    try {
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
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (response.ok) {
        const json = await response.json();
        const text = json.content[0].text;
        if (isJson) {
          const match = text.match(/\{[\s\S]*?\}/);
          result = JSON.parse(match ? match[0] : text);
        } else {
          result = text.trim();
        }
      }
    } catch (err) { console.error('Anthropic Error:', err); }
  }

  // 2nd Priority: OpenAI (fallback)
  if (!result && env.OPENAI_API_KEY) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          response_format: isJson ? { type: 'json_object' } : undefined,
          temperature: 0.7,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (response.ok) {
        const json = await response.json();
        const text = json.choices[0].message.content;
        result = isJson ? JSON.parse(text) : text.trim();
      }
    } catch (err) { console.error('OpenAI Error:', err); }
  }

  return result;
}

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();

    // 모드 1: 아이 성향 분석 (그림 프롬프트 생성)
    if (data.mode === 'analyze_profile') {
      const { favorite, hobby, dream, etc } = data.profile;
      const prompt = `
        다음은 한 어린이의 성향과 관심사 정보야:
        - 좋아하는 캐릭터/만화/게임: ${favorite || '없음'}
        - 취미나 좋아하는 활동: ${hobby || '없음'}
        - 장래희망: ${dream || '없음'}
        - 기타 특징: ${etc || '없음'}

        이 아이의 성향과 관심사를 분석해서, 이 아이가 직접 그릴 법한 그림의 내용을 딱 한 문장으로 상세하게 묘사해줘. 
        결과는 Gemini 이미지 생성 프롬프트로 바로 쓸 수 있게 영어로 출력해줘.
        예를 들어 "A drawing of a cute robot wearing a crown and playing soccer in a vibrant flower garden" 처럼 구체적인 장면이어야 해.
        불필요한 설명 없이 오직 영어 문장 하나만 출력해.
      `;
      const systemPrompt = "You are a child psychology and art education expert. Output only a single English sentence for image generation.";
      const resultText = await callAI(prompt, env, systemPrompt, false);
      
      if (!resultText) throw new Error('AI analysis failed');
      return new Response(JSON.stringify({ prompt: resultText }), { headers: corsHeaders() });
    }

    // 모드 2: 기존 리포트 생성 (기존 로직)
    const { projectName, studentName, sessionInfo, reportDate, teacherName, student_comment, teacher_comment, storyboardImg, processImg, finalImg } = data;
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    const basePrompt = `
    다음 미술 수업 데이터를 바탕으로 리포트의 모든 필드를 최적으로 완성해줘. 
    기존에 입력된 내용이 있다면 그것을 바탕으로 더 전문적이고 다정한 어조로 '개선'하고, 비어있는 필드는 사진 분석과 문맥을 통해 자연스럽게 '추론'해서 채워줘.

    [필드별 작성 지침]
    1. projectName: 프로젝트의 성격을 잘 나타내는 멋진 이름을 지어줘.
    2. studentName: 아이의 이름을 추론하거나 기존 이름을 사용해.
    3. sessionInfo: 몇 회차인지 추론해.
    4. reportDate: 비어있으면 "${today}"로 채워줘.
    5. teacherName: 선생님의 이름을 멋지게 지어줘.
    6. student_comment (수업 활동 내용): 학생이 오늘 수행한 구체적인 작업물과 특징을 1~2문장으로 생생하게 요약해줘.
    7. teacher_comment: 그림 결과물과 수업태도, 창의성을 종합 분석하여 3~4문장으로 따뜻하고 다정하게 격려해줘.

    [입력 데이터]
    - 기존 프로젝트명: ${projectName || '입력 안됨'}
    - 기존 학생명: ${studentName || '입력 안됨'}
    - 기존 회차: ${sessionInfo || '입력 안됨'}
    - 기존 날짜: ${reportDate || '입력 안됨'}
    - 기존 선생님: ${teacherName || '입력 안됨'}
    - 기존 수업 활동 내용: ${student_comment || '입력 안됨'}
    - 기존 선생님 코멘트: ${teacher_comment || '입력 안됨'}

    반드시 JSON 형식으로 반환:
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

    const systemPrompt = "You are a professional art education consultant. You must output perfectly valid JSON without backticks or extra text.";
    const result = await callAI(basePrompt, env, systemPrompt, true);

    if (!result) throw new Error('Failed to generate content.');
    return new Response(JSON.stringify(result), { headers: corsHeaders() });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
  }
}
