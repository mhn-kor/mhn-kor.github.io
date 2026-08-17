/* 무기 종류별 SP 스킬(기본)과 스타일 강화 선택지.
 *
 * SP 스킬은 공식 무기 페이지에서 확인했습니다 (무기 종류마다 하나로 공통).
 * 스타일 강화 목록은 게임 내 데이터라 공식 사이트·참조 사이트의 공개 데이터에
 * 없습니다. 실제 플레이로 확인한 값을 적어 두었습니다.
 */
const BD_SP = {
  'shield-sword': '저스트 러시 콤보',
  'great-sword': '참 모아베기',
  'long-sword': '기인 투구 깨기',
  'dual-blades': '공중 회전난무 천',
  hammer: '회전공격',
  'hunting-horn': '3음 연주',
  lance: '돌진',
  gunlance: '용격포',
  'switch-axe': '영거리해방찌르기',
  'charge-blade': '초고출력 속성 해방 베기',
  'insect-glaive': '급습 찌르기',
  'light-gun': '반격 용탄',
  'heavy-gun': '기관 용탄',
  bow: '용화살',
};

const BD_STYLES = {
  'shield-sword': ['파고들어베기', '저스트러시'],
  'dual-blades': ['귀인화[짐승]', '나선참'],
  'great-sword': ['수류베기', '격앙참'],
  'long-sword': ['위합', '기인 무쌍베기'],
  hammer: ['수면 치기', '임팩트 크레이터'],
  'hunting-horn': ['민첩의 선율', '향타'],
  lance: ['실드 태클', '저스트 가드'],
  gunlance: ['블래스트 대시', '가드 리로드'],
  'switch-axe': ['비상용검', '속성충전 카운터'],
  'charge-blade': ['검 강화', '도끼 강화'],
  'light-gun': ['스텝 샷', '슬라이딩 리로드'],
  'heavy-gun': ['가드리로드', '앉아쏘기'],
  bow: ['회피 근접공격', '강연사'],
  'insect-glaive': ['조충 베기', '각충격'],
};
