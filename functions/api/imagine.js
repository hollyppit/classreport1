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

    if (type === 'generate' || (type === 'upscale' && !image)) {
      // 1. 순수 이미지 생성 (Imagen 3 모델 사용)
      const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: finalPrompt }],
          parameters: { sampleCount: 1 }
        })
      });

      const resJson = await response.json();

      if (!response.ok) {
        console.error('Imagen API Error:', resJson);
        throw new Error(resJson.error?.message || 'Imagen API 호출 실패');
      }

      if (resJson.predictions && resJson.predictions[0]?.bytesBase64Encoded) {
        resultImage = `data:image/png;base64,${resJson.predictions[0].bytesBase64Encoded}`;
      } else {
        throw new Error('생성된 이미지 데이터를 찾을 수 없습니다.');
      }

    } else if (type === 'upscale' && image) {
      // 2. 이미지 기반 퀄업 (기존 Gemini 멀티모달 사용하되 에러 처리 강화)
      // Imagen 3는 현재 Text-to-Image 특화이므로 퀄업은 Gemini 2.0 Flash로 시도
      const model = 'gemini-2.0-flash-exp';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      const [mime, base64Data] = image.split(',');
      const mimeType = mime.match(/:(.*?);/)[1];

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "이 어린이 그림을 웹툰/일러스트 스타일로 깔끔하고 고품질로 재해석해서 새로 그려줘. 원본 구도는 유지해줘." },
              { inlineData: { mimeType: mimeType, data: base64Data } }
            ]
          }],
          generationConfig: { responseModalities: ["IMAGE"] }
        })
      });

      const resJson = await response.json();
      if (!response.ok) {
        console.error('Gemini Upscale Error:', resJson);
        throw new Error(resJson.error?.message || '퀄업 중 Gemini API 에러 발생');
      }

      const imagePart = resJson.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (imagePart) {
        resultImage = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
      } else {
        throw new Error('퀄업 결과 이미지를 생성하지 못했습니다.');
      }
    }

    return new Response(JSON.stringify({ image: resultImage }), { headers: corsHeaders() });

  } catch (e) {
    console.error('Imagine Function Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders() });
  }
}
