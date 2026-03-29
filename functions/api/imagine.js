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

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { type, prompt, image, studentComment } = await request.json();
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error('GEMINI_API_KEY missing');
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY가 Cloudflare 환경 변수에 설정되어 있지 않습니다.' }), { status: 500, headers: corsHeaders() });
    }

    // 우선순위: 프론트엔드에서 넘어온 prompt가 있으면 사용, 없으면 studentComment로 생성
    let finalPrompt = prompt || (studentComment ? `A child's drawing about: ${studentComment}` : 'A happy child drawing');

    // 스타일 지시어 보강 (이미 프론트에서 붙여서 오겠지만, 백엔드에서도 안전하게 처리)
    if (type === 'generate' && !finalPrompt.includes('drawn by')) {
        finalPrompt += ", drawn by a Korean elementary school child, crayon or colored pencil style, slightly crooked and cute lines, on white paper, warm and cheerful";
    }

    let resultImage = null;

    if (type === 'generate') {
      // 1. 이미지 생성 (Gemini 멀티 모델 폴백)
      const models = [
        'gemini-2.5-flash-image',
        'gemini-3.1-flash-image-preview',
        'gemini-3-pro-image-preview'
      ];
      
      let lastError = '';

      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: finalPrompt }] }],
              generationConfig: { responseModalities: ['IMAGE'] }
            })
          });

          const resJson = await response.json();

          if (!response.ok) {
            const errTxt = resJson.error?.message || '실패';
            throw new Error(`[${model}] ${errTxt}`);
          }

          const imagePart = resJson.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (imagePart) {
            resultImage = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            break; // 성공 시 루프 중단
          } else {
            throw new Error(`[${model}] 이미지 데이터를 찾을 수 없습니다`);
          }
        } catch (e) {
          lastError += e.message + ' | ';
          console.warn(`${model} 시도 실패:`, e.message);
        }
      }

      if (!resultImage) {
        throw new Error('모든 Gemini 모델 시도 실패: ' + lastError);
      }

    } else if (type === 'upscale' && image) {
      // --- '운명의 거울' 프로젝트(caricature) 방식의 이미지-투-이미지 로직 이식 ---
      const models = [
        'gemini-2.5-flash-image',
        'gemini-3.1-flash-image-preview',
      ];
      
      const [mime, base64Data] = image.split(',');
      const mimeType = mime.match(/:(.*?);/)[1];
      let lastError = '';

      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inlineData: { mimeType: mimeType, data: base64Data } },
                  { text: "이 그림을 자연스럽게 다듬어줘. 선을 살짝 정리하고 색감을 채워주되, 수작업으로 직접 그린 느낌이 남아있어야 해. 완성도 높은 일러스트가 아니라, 아이가 열심히 그린 그림처럼 보여야 해. 원본의 구도와 형태는 최대한 유지해줘." }
                ]
              }],
              generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
            })
          });

          const resJson = await response.json();
          if (!response.ok) {
            const errTxt = resJson.error?.message || '실패';
            throw new Error(`[${model}] ${errTxt}`);
          }

          const imagePart = resJson.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (imagePart) {
            resultImage = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            break;
          } else {
            throw new Error(`[${model}] 퀄업 결과 이미지를 찾을 수 없습니다`);
          }
        } catch (e) {
          lastError += e.message + ' | ';
          console.warn(`${model} 퀄업 시도 실패:`, e.message);
        }
      }

      if (!resultImage) {
        throw new Error('퀄업 모든 모델 시도 실패: ' + lastError);
      }
    }

    return new Response(JSON.stringify({ image: resultImage }), { headers: corsHeaders() });

  } catch (e) {
    console.error('Imagine Function Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders() });
  }
}
